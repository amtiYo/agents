import path from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { commandExists, runCommand } from './shell.js'
import { listClaudeManagedServerNames } from './claudeCli.js'
import { toManagedClaudeName } from '../integrations/claude.js'
import { getProjectScopePrefix, toProjectScopedName } from './globalScope.js'
import { validateEnvValueForShell, validateServerName } from './mcpValidation.js'
import type { ResolvedMcpServer } from '../types.js'

type ClaudeCliScope = 'local' | 'user'

interface ClaudeState {
  scope?: ClaudeCliScope
  managedNames: string[]
  definitionHashes?: Record<string, string>
}

/** Sync CLI registrations, retaining their scope so changes and reset clean the right entries. */
export async function syncClaude(args: {
  scope: ClaudeCliScope
  enabled: boolean
  check: boolean
  projectRoot: string
  servers: ResolvedMcpServer[]
  statePath: string
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, scope, check, projectRoot, servers, statePath, changed, warnings } = args

  let state: ClaudeState = { managedNames: [] }
  if (await pathExists(statePath)) {
    state = await readJson<ClaudeState>(statePath)
  }

  for (const server of servers) {
    validateServerName(server.name)
  }

  function managedName(name: string): string {
    if (scope === 'user') return toProjectScopedName(projectRoot, name)
    return toManagedClaudeName(name)
  }

  const desiredServers = enabled ? servers : []
  const desiredNames = desiredServers.map(server => managedName(server.name))
  const definitionHashes = Object.fromEntries(servers.map(server => [
    managedName(server.name), createHash('sha256').update(JSON.stringify(server)).digest('hex')
  ]))
  let currentNames = state.managedNames ?? []
  if (!commandExists('claude')) {
    if (enabled || state.managedNames.length > 0) {
      warnings.push('Claude CLI not found; skipped Claude MCP sync.')
      if (!enabled && state.managedNames.length > 0) {
        throw new Error('Claude CLI not found; cannot remove managed Claude MCP servers.')
      }
    }
    return
  }

  const previousScope = state.scope ?? 'local'
  const registrationScope = enabled ? scope : previousScope
  if (enabled && previousScope !== scope && state.managedNames.length > 0) {
    changed.push(`claude-${previousScope}-scope`, `claude-${scope}-scope`)
    if (check) return
    const failedNames: string[] = []
    const errors: string[] = []
    for (const name of state.managedNames) {
      const error = removeClaudeServer(projectRoot, previousScope, name)
      if (error) {
        failedNames.push(name)
        errors.push(error)
      }
    }
    state = { scope: previousScope, managedNames: failedNames, definitionHashes: state.definitionHashes }
    await writeJsonAtomic(statePath, state)
    if (errors.length > 0) throw new Error(errors.join('\n'))
    currentNames = []
  }

  if (enabled) {
    const prefix = scope === 'user' ? getProjectScopePrefix(projectRoot) : 'agents__'
    const listed = listClaudeManagedServerNames(projectRoot, prefix, 5000)
    if (!listed.ok) {
      throw new Error(`Failed checking Claude MCP status: ${compactError(listed.stderr)}`)
    }

    currentNames = listed.names
    // `mcp list` merges all scopes. Local sync must not adopt another project's
    // user registrations; only desired names and recorded ownership belong here.
    if (scope === 'local') {
      currentNames = currentNames.filter(name =>
        desiredNames.includes(name) || state.managedNames.includes(name))
    }
  }

  const namesToUpdate = desiredNames.filter(name => currentNames.includes(name)
    && state.definitionHashes?.[name] !== definitionHashes[name])
  if (isDeepStrictEqual(new Set(currentNames), new Set(desiredNames)) && namesToUpdate.length === 0) {
    return
  }
  changed.push(`claude-${registrationScope}-scope`)

  if (check) return

  const namesToRemove = currentNames.filter((name) => !desiredNames.includes(name) || namesToUpdate.includes(name))
  const errors: string[] = []
  const failedRemovals = new Set<string>()
  for (const name of namesToRemove) {
    const error = removeClaudeServer(projectRoot, registrationScope, name)
    if (error) {
      errors.push(error)
      failedRemovals.add(name)
    }
  }

  const appliedNames: string[] = []
  for (const server of desiredServers) {
    const name = managedName(server.name)
    if (failedRemovals.has(name)) continue
    if (currentNames.includes(name) && !namesToUpdate.includes(name)) {
      appliedNames.push(name)
      continue
    }
    const result = addClaudeServer(projectRoot, scope, name, server)
    if (!result.ok) {
      errors.push(`Failed adding Claude MCP server ${name}: ${compactError(result.stderr)}`)
      continue
    }
    appliedNames.push(name)
  }

  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    scope: registrationScope,
    managedNames: [...new Set([...appliedNames, ...failedRemovals])],
    definitionHashes: {
      ...Object.fromEntries([...failedRemovals].map(name => [name, state.definitionHashes?.[name]])),
      ...Object.fromEntries(appliedNames.map(name => [name, definitionHashes[name]]))
    }
  })
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function addClaudeServer(
  projectRoot: string,
  scope: ClaudeCliScope,
  name: string,
  server: ResolvedMcpServer,
): { ok: boolean; stderr: string } {
  const args: string[] = ['mcp', 'add', '-s', scope]
  if (server.transport === 'stdio') {
    if (!server.command) {
      return { ok: false, stderr: 'missing command' }
    }

    args.push(name)
    for (const [key, value] of Object.entries(server.env ?? {})) {
      validateEnvValueForShell(key, value, 'environment variable')
      args.push('-e', `${key}=${value}`)
    }
    args.push('--', server.command, ...(server.args ?? []))
  } else {
    if (!server.url) {
      return { ok: false, stderr: 'missing url' }
    }

    args.push('-t', server.transport, name, server.url)
    for (const [key, value] of Object.entries(server.headers ?? {})) {
      validateEnvValueForShell(key, value, 'header')
      args.push('-H', `${key}: ${value}`)
    }
  }

  const result = runCommand('claude', args, projectRoot)
  return { ok: result.ok || isClaudeAlreadyExistsError(result.stderr), stderr: result.stderr }
}

function isClaudeAlreadyExistsError(stderr: string): boolean {
  return /already exists in (local|user) config/i.test(stderr)
}

function removeClaudeServer(projectRoot: string, scope: ClaudeCliScope, name: string): string | null {
  const removed = runCommand('claude', ['mcp', 'remove', '-s', scope, name], projectRoot)
  if (removed.ok || /not found|No .*MCP server (found|named)/i.test(removed.stderr)) return null
  return `Failed removing Claude MCP server ${name}: ${compactError(removed.stderr)}`
}

function compactError(stderr: string): string {
  return stderr.trim().split('\n').at(-1) ?? 'unknown error'
}
