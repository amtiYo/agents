import path from 'node:path'
import { ensureDir, pathExists, readJson, readTextOrEmpty, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { loadAgentsConfig, saveAgentsConfig } from './config.js'
import { loadResolvedRegistry } from './mcp.js'
import { getProjectPaths } from './paths.js'
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
import { syncVscodeSettings } from './vscodeSettings.js'
import { listCursorMcpStatuses } from './cursorCli.js'
import { listClaudeManagedServerNames } from './claudeCli.js'
import { validateEnvKey, validateEnvValueForShell, validateHeaderKey, validateServerName } from './mcpValidation.js'
import type { IntegrationName, ResolvedMcpServer, SyncOptions, SyncResult } from '../types.js'

interface ClaudeState {
  managedNames: string[]
}

interface CursorState {
  managedNames: string[]
}

export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { projectRoot, check, verbose } = options
  const paths = getProjectPaths(projectRoot)
  const config = await loadAgentsConfig(projectRoot)

  const resolved = await loadResolvedRegistry(projectRoot)
  const warnings = [...resolved.warnings]
  if (resolved.missingRequiredEnv.length > 0) {
    warnings.push(`Skipped servers because required env vars are missing: ${resolved.missingRequiredEnv.join('; ')}`)
  }
  validateResolvedServers(resolved.serversByTarget)

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

  const enabled = new Set(config.integrations.enabled)

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
    autoApprove: config.integrations.options.cursorAutoApprove,
    check,
    projectRoot,
    servers: resolved.serversByTarget.cursor,
    statePath: paths.generatedCursorState,
    changed,
    warnings
  })

  await syncSkills({
    projectRoot,
    enabledIntegrations: config.integrations.enabled,
    check,
    changed,
    warnings
  })

  await syncVscodeSettings({
    settingsPath: paths.vscodeSettings,
    statePath: paths.generatedVscodeSettingsState,
    hiddenPaths: config.workspace.vscode.hiddenPaths,
    hideGenerated: config.workspace.vscode.hideGenerated,
    check,
    changed,
    warnings,
    projectRoot
  })

  if (!check) {
    config.lastSync = new Date().toISOString()
    await saveAgentsConfig(projectRoot, config)
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
  const rawGenerated = await readTextOrEmpty(generatedPath)
  let generated: Record<string, unknown> = {}
  if (rawGenerated.trim()) {
    try {
      generated = JSON.parse(rawGenerated) as Record<string, unknown>
    } catch (error) {
      throw new Error(`Failed to parse generated Gemini config: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  let existing: Record<string, unknown> = {}
  if (await pathExists(targetPath)) {
    try {
      existing = await readJson<Record<string, unknown>>(targetPath)
    } catch (error) {
      // Warn instead of silently ignoring - corrupted files should be noticed
      console.warn(`Warning: Failed to read existing Gemini config at ${targetPath}, starting fresh. Error: ${error instanceof Error ? error.message : String(error)}`)
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

  // Validate all server names before using them in commands
  for (const server of servers) {
    validateServerName(server.name)
  }

  const desiredNames = enabled ? servers.map((server) => toManagedClaudeName(server.name)) : []
  let currentNames = state.managedNames ?? []
  const hasClaudeCli = commandExists(command)

  if (hasClaudeCli) {
    const listed = listClaudeManagedServerNames(projectRoot)
    if (listed.ok) {
      currentNames = listed.names
    } else {
      warnings.push(`Failed checking Claude MCP status: ${compactError(listed.stderr)}`)
    }
  }

  if (equalSets(new Set(currentNames), new Set(desiredNames))) {
    return
  }
  changed.push('claude-local-scope')

  if (check) return

  if (!hasClaudeCli) {
    warnings.push('Claude CLI not found; skipped Claude MCP sync.')
    return
  }

  // Remove servers that exist in current but not in desired (proper set difference)
  const namesToRemove = currentNames.filter((name) => !desiredNames.includes(name))
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

  // Validate all server names before using them in commands
  for (const server of servers) {
    validateServerName(server.name)
  }

  const desiredNames = enabled ? servers.map((server) => server.name) : []
  const currentNames = state.managedNames ?? []
  const hasCursorCli = commandExists(command)
  let namesNeedingApproval = new Set<string>()

  if (enabled && autoApprove && hasCursorCli) {
    const listed = listCursorMcpStatuses(projectRoot)
    if (!listed.ok) {
      warnings.push(`Failed checking Cursor MCP status: ${compactError(listed.stderr)}`)
    } else {
      const unknownStatuses: string[] = []
      const errorStatuses: string[] = []
      namesNeedingApproval = new Set<string>()

      for (const name of desiredNames) {
        const status = listed.statuses[name]
        if (status === undefined) {
          namesNeedingApproval.add(name)
          continue
        }
        if (status === 'needs-approval' || status === 'disabled') {
          namesNeedingApproval.add(name)
          continue
        }
        if (status === 'unknown') {
          unknownStatuses.push(name)
          continue
        }
        if (status === 'error') {
          errorStatuses.push(name)
        }
      }

      if (unknownStatuses.length > 0) {
        warnings.push(
          `Cursor MCP status unknown for: ${unknownStatuses.join(', ')}. Skipping auto-approval retries for these servers.`,
        )
      }
      if (errorStatuses.length > 0) {
        warnings.push(
          `Cursor MCP connection errors for: ${errorStatuses.join(', ')}. Skipping auto-approval retries for these servers.`,
        )
      }
    }
  }

  if (
    equalSets(new Set(currentNames), new Set(desiredNames))
    && namesNeedingApproval.size === 0
  ) {
    return
  }
  changed.push('cursor-local-approval')

  if (check) return

  if (!hasCursorCli) {
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
    if (!namesNeedingApproval.has(name)) {
      approved.push(name)
      continue
    }
    const result = runCommand(command, ['mcp', 'enable', name], projectRoot)
    if (!result.ok && !isCursorAlreadyEnabledError(result.stderr)) {
      warnings.push(`Failed enabling Cursor MCP server ${name}: ${compactError(result.stderr)}`)
      continue
    }
    approved.push(name)
  }

  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, { managedNames: approved })
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
    // Validate environment variables before using them
    for (const [key, value] of Object.entries(server.env ?? {})) {
      validateEnvValueForShell(key, value, 'environment variable')
      args.push('-e', `${key}=${value}`)
    }
    args.push('--', server.command, ...(server.args ?? []))
    const result = runCommand(command, args, projectRoot)
    if (!result.ok && isClaudeAlreadyExistsError(result.stderr)) {
      return { ok: true, stderr: result.stderr }
    }
    return { ok: result.ok, stderr: result.stderr }
  }

  if (!server.url) {
    return { ok: false, stderr: 'missing url' }
  }

  const args: string[] = ['mcp', 'add', '-s', 'local', '-t', server.transport, name, server.url]
  // Validate headers before using them
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    validateEnvValueForShell(key, value, 'header')
    args.push('-H', `${key}: ${value}`)
  }
  const result = runCommand(command, args, projectRoot)
  if (!result.ok && isClaudeAlreadyExistsError(result.stderr)) {
    return { ok: true, stderr: result.stderr }
  }
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

function isClaudeAlreadyExistsError(stderr: string): boolean {
  return stderr.toLowerCase().includes('already exists in local config')
}

function isCursorAlreadyEnabledError(stderr: string): boolean {
  const lowered = stderr.toLowerCase()
  return lowered.includes('already enabled') || lowered.includes('already approved')
}

function validateResolvedServers(resolvedByTarget: Record<IntegrationName, ResolvedMcpServer[]>): void {
  for (const [target, servers] of Object.entries(resolvedByTarget)) {
    for (const server of servers) {
      validateServerName(server.name)
      for (const [key, value] of Object.entries(server.env ?? {})) {
        try {
          validateEnvKey(key, 'environment variable')
        } catch (error) {
          throw new Error(
            `Invalid environment variable key "${key}" in server "${server.name}" (target: ${target}): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        validateEnvValueForShell(key, value, 'environment variable')
      }
      for (const [key, value] of Object.entries(server.headers ?? {})) {
        try {
          validateHeaderKey(key, 'header')
        } catch (error) {
          throw new Error(
            `Invalid header key "${key}" in server "${server.name}" (target: ${target}): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        validateEnvValueForShell(key, value, 'header')
      }
    }
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
