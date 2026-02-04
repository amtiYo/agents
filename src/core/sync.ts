import path from 'node:path'
import { ensureDir, pathExists, readJson, readTextOrEmpty, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import { loadConfig, saveConfig } from './config.js'
import { loadResolvedRegistry } from './mcp.js'
import { commandExists, runCommand } from './shell.js'
import type { IntegrationName, ResolvedMcpServer, SyncOptions, SyncResult } from '../types.js'
import { toManagedClaudeName } from '../integrations/claude.js'
import { buildCodexConfig } from '../integrations/codex.js'
import { buildGeminiPayload } from '../integrations/gemini.js'
import { buildVscodeMcpPayload } from '../integrations/copilotVscode.js'
import { renderVscodeMcp } from './renderers.js'

interface ClaudeState {
  managedNames: string[]
}

export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { projectRoot, check, verbose } = options
  const paths = getProjectPaths(projectRoot)
  const config = await loadConfig(projectRoot)
  const resolved = await loadResolvedRegistry(projectRoot)
  const warnings = [...resolved.warnings]
  if (resolved.missingRequiredEnv.length > 0) {
    warnings.push(
      `Skipped servers because required env vars are missing: ${resolved.missingRequiredEnv.join('; ')}`,
    )
  }

  const changed: string[] = []

  await ensureDir(paths.generatedDir)

  await syncGeneratedFiles({
    projectRoot,
    check,
    changed,
    warnings,
    resolvedByTarget: resolved.serversByTarget
  })

  const enabled = new Set(config.enabledIntegrations)

  if (enabled.has('codex')) {
    await materializeCodex(paths.generatedCodex, paths.codexConfig, check, changed)
  }

  if (enabled.has('gemini')) {
    await materializeGemini(paths.generatedGemini, paths.geminiSettings, check, changed)
  }

  if (enabled.has('copilot_vscode')) {
    await materializeCopilot(paths.generatedCopilot, paths.vscodeMcp, check, changed)
  }

  await syncClaude({
    enabled: enabled.has('claude'),
    check,
    projectRoot,
    servers: resolved.serversByTarget.claude,
    statePath: paths.generatedClaudeState,
    changed,
    warnings
  })

  if (!check) {
    config.lastSync = new Date().toISOString()
    await saveConfig(projectRoot, config)
  }

  if (verbose && changed.length > 0) {
    for (const entry of changed) {
      process.stdout.write(`updated: ${entry}\n`)
    }
  }

  return { changed, warnings }
}

async function syncGeneratedFiles(args: {
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
  resolvedByTarget: Record<IntegrationName, ResolvedMcpServer[]>
}): Promise<void> {
  const { projectRoot, check, changed, warnings, resolvedByTarget } = args
  const paths = getProjectPaths(projectRoot)

  const codex = buildCodexConfig(resolvedByTarget.codex)
  warnings.push(...codex.warnings)
  await writeManagedFile(paths.generatedCodex, codex.content, projectRoot, check, changed)

  const gemini = buildGeminiPayload(resolvedByTarget.gemini)
  warnings.push(...gemini.warnings)
  await writeManagedFile(
    paths.generatedGemini,
    `${JSON.stringify(gemini.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  )

  const copilot = buildVscodeMcpPayload(resolvedByTarget.copilot_vscode)
  warnings.push(...copilot.warnings)
  await writeManagedFile(
    paths.generatedCopilot,
    `${JSON.stringify(copilot.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  )

  const claude = renderVscodeMcp(resolvedByTarget.claude)
  warnings.push(...claude.warnings)
  await writeManagedFile(
    paths.generatedClaude,
    `${JSON.stringify({ mcpServers: claude.servers }, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  )
}

async function materializeCodex(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const content = await readTextOrEmpty(generatedPath)
  await writeManagedFile(targetPath, content, path.dirname(path.dirname(targetPath)), check, changed)
}

async function materializeGemini(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const generated = JSON.parse(await readTextOrEmpty(generatedPath)) as Record<string, unknown>

  let existing: Record<string, unknown> = {}
  if (await pathExists(targetPath)) {
    try {
      existing = await readJson<Record<string, unknown>>(targetPath)
    } catch {
      existing = {}
    }
  }

  const merged: Record<string, unknown> = {
    ...existing,
    context: {
      ...(typeof existing.context === 'object' && existing.context !== null
        ? (existing.context as Record<string, unknown>)
        : {}),
      fileName: 'AGENTS.md'
    },
    contextFileName: generated.contextFileName,
    mcpServers: generated.mcpServers
  }

  await writeManagedFile(
    targetPath,
    `${JSON.stringify(merged, null, 2)}\n`,
    path.dirname(path.dirname(targetPath)),
    check,
    changed,
  )
}

async function materializeCopilot(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const content = await readTextOrEmpty(generatedPath)
  await writeManagedFile(targetPath, content, path.dirname(path.dirname(targetPath)), check, changed)
}

async function syncClaude(args: {
  enabled: boolean
  check: boolean
  projectRoot: string
  servers: ResolvedMcpServer[]
  statePath: string
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, check, projectRoot, servers, statePath, changed, warnings } = args
  const command = 'claude'

  const state: ClaudeState = (await pathExists(statePath))
    ? await readJson<ClaudeState>(statePath)
    : { managedNames: [] }

  const desiredNames = enabled ? servers.map((server) => toManagedClaudeName(server.name)) : []
  const currentNames = state.managedNames ?? []

  if (equalSets(new Set(currentNames), new Set(desiredNames))) {
    return
  } else {
    changed.push('claude-local-scope')
  }

  if (check) return

  if (!commandExists(command)) {
    warnings.push('Claude CLI not found; skipped Claude MCP sync.')
    return
  }

  const namesToRemove = [...new Set([...currentNames, ...desiredNames])]
  for (const name of namesToRemove) {
    const removed = runCommand(command, ['mcp', 'remove', '-s', 'local', name], projectRoot)
    if (!removed.ok && !removed.stderr.includes('not found')) {
      warnings.push(`Failed removing Claude MCP server ${name}: ${compactError(removed.stderr)}`)
    }
  }

  if (!enabled) {
    await writeJsonAtomic(statePath, { managedNames: [] })
    return
  }

  const appliedNames: string[] = []

  for (const server of servers) {
    const name = toManagedClaudeName(server.name)
    const result = addClaudeServer(command, projectRoot, name, server)
    if (!result.ok) {
      warnings.push(`Failed adding Claude MCP server ${name}: ${compactError(result.stderr)}`)
      continue
    }
    appliedNames.push(name)
  }

  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, { managedNames: appliedNames })
}

function addClaudeServer(
  command: string,
  projectRoot: string,
  name: string,
  server: ResolvedMcpServer,
): { ok: boolean; stderr: string } {
  if (server.transport === 'stdio') {
    if (!server.command) {
      return { ok: false, stderr: 'missing command' }
    }
    const args: string[] = ['mcp', 'add', '-s', 'local', name]
    for (const [key, value] of Object.entries(server.env ?? {})) {
      args.push('-e', `${key}=${value}`)
    }
    args.push('--', server.command, ...(server.args ?? []))
    const result = runCommand(command, args, projectRoot)
    return { ok: result.ok, stderr: result.stderr }
  }

  if (!server.url) {
    return { ok: false, stderr: 'missing url' }
  }
  const args: string[] = ['mcp', 'add', '-s', 'local', '-t', server.transport, name, server.url]
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    args.push('-H', `${key}: ${value}`)
  }
  const result = runCommand(command, args, projectRoot)
  return { ok: result.ok, stderr: result.stderr }
}

async function writeManagedFile(
  absolutePath: string,
  content: string,
  projectRoot: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const previous = await readTextOrEmpty(absolutePath)
  const relative = path.relative(projectRoot, absolutePath) || absolutePath
  if (previous === content) return
  changed.push(relative)
  if (check) return
  await writeTextAtomic(absolutePath, content)
}

function equalSets(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

function compactError(stderr: string): string {
  return stderr.trim().split('\n').at(-1) ?? 'unknown error'
}
