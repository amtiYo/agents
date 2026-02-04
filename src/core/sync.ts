import { createHash } from 'node:crypto'
import path from 'node:path'
import { ensureDir, pathExists, readJson, readTextOrEmpty, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { loadProjectConfig, saveProjectConfig } from './config.js'
import { ensureGlobalCatalog } from './catalog.js'
import { loadResolvedRegistry } from './mcp.js'
import { getAntigravityUserMcpPath, getProjectPaths } from './paths.js'
import { commandExists, runCommand } from './shell.js'
import { buildCodexConfig } from '../integrations/codex.js'
import { toManagedClaudeName } from '../integrations/claude.js'
import { buildGeminiPayload } from '../integrations/gemini.js'
import { buildVscodeMcpPayload } from '../integrations/copilotVscode.js'
import { buildCursorPayload } from '../integrations/cursor.js'
import { buildAntigravityPayload } from '../integrations/antigravity.js'
import { renderVscodeMcp } from './renderers.js'
import { ensureProjectGitignore } from './gitignore.js'
import { syncSkills } from './skills.js'
import type { IntegrationName, ResolvedMcpServer, SyncOptions, SyncResult } from '../types.js'

interface ClaudeState {
  managedNames: string[]
}

interface CursorState {
  managedNames: string[]
}

interface AntigravityState {
  managedNames: string[]
}

export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { projectRoot, check, verbose } = options
  const paths = getProjectPaths(projectRoot)
  const config = await loadProjectConfig(projectRoot)
  const { catalog } = await ensureGlobalCatalog()

  const resolved = await loadResolvedRegistry(projectRoot)
  const warnings = [...resolved.warnings]
  if (resolved.missingRequiredEnv.length > 0) {
    warnings.push(`Skipped servers because required env vars are missing: ${resolved.missingRequiredEnv.join('; ')}`)
  }

  const changed: string[] = []

  if (!check) {
    const gitignoreChanged = await ensureProjectGitignore(projectRoot, config.syncMode)
    if (gitignoreChanged) {
      changed.push('.gitignore')
    }
  }

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
  if (enabled.has('cursor')) {
    await materializeCursor(paths.generatedCursor, paths.cursorMcp, check, changed)
  }
  if (enabled.has('antigravity')) {
    await materializeAntigravityProject(paths.generatedAntigravity, paths.antigravityProjectMcp, check, changed)
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

  await syncCursor({
    enabled: enabled.has('cursor'),
    autoApprove: config.integrationOptions.cursorAutoApprove,
    check,
    projectRoot,
    servers: resolved.serversByTarget.cursor,
    statePath: paths.generatedCursorState,
    changed,
    warnings
  })

  await syncAntigravity({
    enabled: enabled.has('antigravity'),
    enableGlobalSync: config.integrationOptions.antigravityGlobalSync,
    check,
    projectRoot,
    servers: resolved.serversByTarget.antigravity,
    statePath: paths.generatedAntigravityState,
    changed,
    warnings
  })

  await syncSkills({
    projectRoot,
    config,
    catalog,
    check,
    changed,
    warnings
  })

  if (!check) {
    config.lastSync = new Date().toISOString()
    await saveProjectConfig(projectRoot, config)
  }

  if (verbose && changed.length > 0) {
    for (const entry of changed) {
      process.stdout.write(`updated: ${entry}\n`)
    }
  }

  return {
    changed: uniqueSorted(changed),
    warnings: uniqueSorted(warnings)
  }
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

  const cursor = buildCursorPayload(resolvedByTarget.cursor)
  warnings.push(...cursor.warnings)
  await writeManagedFile(
    paths.generatedCursor,
    `${JSON.stringify(cursor.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  )

  const antigravity = buildAntigravityPayload(resolvedByTarget.antigravity)
  warnings.push(...antigravity.warnings)
  await writeManagedFile(
    paths.generatedAntigravity,
    `${JSON.stringify(antigravity.payload, null, 2)}\n`,
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

async function materializeCodex(generatedPath: string, targetPath: string, check: boolean, changed: string[]): Promise<void> {
  const content = await readTextOrEmpty(generatedPath)
  await writeManagedFile(targetPath, content, path.dirname(path.dirname(targetPath)), check, changed)
}

async function materializeGemini(generatedPath: string, targetPath: string, check: boolean, changed: string[]): Promise<void> {
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

async function materializeCopilot(generatedPath: string, targetPath: string, check: boolean, changed: string[]): Promise<void> {
  const content = await readTextOrEmpty(generatedPath)
  await writeManagedFile(targetPath, content, path.dirname(path.dirname(targetPath)), check, changed)
}

async function materializeCursor(generatedPath: string, targetPath: string, check: boolean, changed: string[]): Promise<void> {
  const content = await readTextOrEmpty(generatedPath)
  await writeManagedFile(targetPath, content, path.dirname(path.dirname(targetPath)), check, changed)
}

async function materializeAntigravityProject(
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
  }
  changed.push('claude-local-scope')

  if (check) return

  if (!commandExists(command)) {
    warnings.push('Claude CLI not found; skipped Claude MCP sync.')
    return
  }

  const namesToRemove = [...new Set([...currentNames, ...desiredNames])]
  for (const name of namesToRemove) {
    const removed = runCommand(command, ['mcp', 'remove', '-s', 'local', name], projectRoot)
    if (
      !removed.ok &&
      !removed.stderr.includes('not found') &&
      !removed.stderr.includes('No project-local MCP server found')
    ) {
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

async function syncCursor(args: {
  enabled: boolean
  autoApprove: boolean
  check: boolean
  projectRoot: string
  servers: ResolvedMcpServer[]
  statePath: string
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, autoApprove, check, projectRoot, servers, statePath, changed, warnings } = args
  const command = 'cursor-agent'

  const state: CursorState = (await pathExists(statePath))
    ? await readJson<CursorState>(statePath)
    : { managedNames: [] }

  const desiredNames = enabled ? servers.map((server) => server.name) : []
  const currentNames = state.managedNames ?? []

  if (equalSets(new Set(currentNames), new Set(desiredNames))) {
    return
  }
  changed.push('cursor-local-approval')

  if (check) return

  if (!commandExists(command)) {
    warnings.push('Cursor CLI not found; skipped Cursor MCP approval sync.')
    return
  }

  const toDisable = currentNames.filter((name) => !desiredNames.includes(name))
  for (const name of toDisable) {
    const result = runCommand(command, ['mcp', 'disable', name], projectRoot)
    if (!result.ok && !result.stderr.toLowerCase().includes('not found')) {
      warnings.push(`Failed disabling Cursor MCP server ${name}: ${compactError(result.stderr)}`)
    }
  }

  if (!enabled || !autoApprove) {
    await writeJsonAtomic(statePath, { managedNames: desiredNames })
    return
  }

  const approved: string[] = []
  for (const name of desiredNames) {
    const result = runCommand(command, ['mcp', 'enable', name], projectRoot)
    if (!result.ok) {
      warnings.push(`Failed enabling Cursor MCP server ${name}: ${compactError(result.stderr)}`)
      continue
    }
    approved.push(name)
  }

  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, { managedNames: approved })
}

async function syncAntigravity(args: {
  enabled: boolean
  enableGlobalSync: boolean
  check: boolean
  projectRoot: string
  servers: ResolvedMcpServer[]
  statePath: string
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, enableGlobalSync, check, projectRoot, servers, statePath, changed, warnings } = args

  if (!enableGlobalSync) {
    const existingState: AntigravityState = (await pathExists(statePath))
      ? await readJson<AntigravityState>(statePath)
      : { managedNames: [] }

    const globalPath = getAntigravityUserMcpPath()
    if (existingState.managedNames.length > 0 && (await pathExists(globalPath))) {
      let existing: { servers?: Record<string, unknown>; inputs?: unknown[] } = { servers: {}, inputs: [] }
      try {
        existing = await readJson<{ servers?: Record<string, unknown>; inputs?: unknown[] }>(globalPath)
      } catch {
        existing = { servers: {}, inputs: [] }
      }

      const serversMap = typeof existing.servers === 'object' && existing.servers !== null
        ? ({ ...(existing.servers as Record<string, unknown>) })
        : {}
      for (const name of existingState.managedNames) {
        delete serversMap[name]
      }

      const next = {
        servers: serversMap,
        inputs: Array.isArray(existing.inputs) ? existing.inputs : []
      }
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        changed.push('antigravity-user-mcp')
        if (!check) {
          await writeTextAtomic(globalPath, `${JSON.stringify(next, null, 2)}\n`)
        }
      }
    }

    if (existingState.managedNames.length > 0 || (await pathExists(statePath))) {
      changed.push(path.relative(projectRoot, statePath) || statePath)
      if (!check) {
        await writeJsonAtomic(statePath, { managedNames: [] } satisfies AntigravityState)
      }
    }
    warnings.push('Antigravity global MCP sync disabled in project settings.')
    return
  }

  const globalPath = getAntigravityUserMcpPath()
  const state: AntigravityState = (await pathExists(statePath))
    ? await readJson<AntigravityState>(statePath)
    : { managedNames: [] }

  let existing: { servers?: Record<string, unknown>; inputs?: unknown[] } = { servers: {}, inputs: [] }
  if (await pathExists(globalPath)) {
    try {
      existing = await readJson<{ servers?: Record<string, unknown>; inputs?: unknown[] }>(globalPath)
    } catch {
      warnings.push(`Antigravity MCP file is invalid JSON, recreating: ${globalPath}`)
      existing = { servers: {}, inputs: [] }
    }
  }

  const serversMap = typeof existing.servers === 'object' && existing.servers !== null
    ? ({ ...(existing.servers as Record<string, unknown>) })
    : {}

  const prefix = antigravityManagedPrefix(projectRoot)
  const desired = enabled
    ? Object.fromEntries(servers.map((server) => [antigravityManagedName(prefix, server.name), toAntigravityServer(server)]))
    : {}

  for (const name of Object.keys(serversMap)) {
    if (name.startsWith(prefix)) {
      delete serversMap[name]
    }
  }
  for (const [name, server] of Object.entries(desired)) {
    serversMap[name] = server
  }

  const next = {
    servers: serversMap,
    inputs: Array.isArray(existing.inputs) ? existing.inputs : []
  }

  const before = JSON.stringify(existing)
  const after = JSON.stringify(next)
  if (before !== after) {
    changed.push('antigravity-user-mcp')
    if (!check) {
      await writeTextAtomic(globalPath, `${JSON.stringify(next, null, 2)}\n`)
    }
  }

  const managedNames = Object.keys(desired).sort((a, b) => a.localeCompare(b))
  if (!equalSets(new Set(state.managedNames ?? []), new Set(managedNames))) {
    changed.push(path.relative(projectRoot, statePath) || statePath)
    if (!check) {
      await writeJsonAtomic(statePath, { managedNames })
    }
  }
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

function antigravityManagedPrefix(projectRoot: string): string {
  const digest = createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 10)
  return `agents__${digest}__`
}

function antigravityManagedName(prefix: string, serverName: string): string {
  return `${prefix}${serverName}`
}

function toAntigravityServer(server: ResolvedMcpServer): Record<string, unknown> {
  if (server.transport === 'stdio') {
    return {
      command: server.command,
      args: server.args ?? [],
      ...(server.env ? { env: server.env } : {})
    }
  }

  return {
    type: server.transport,
    url: server.url,
    ...(server.headers ? { headers: server.headers } : {})
  }
}

async function writeManagedFile(
  absolutePath: string,
  content: string,
  projectRoot: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const previous = await readTextOrEmpty(absolutePath)
  if (previous === content) return

  const relative = path.relative(projectRoot, absolutePath) || absolutePath
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
