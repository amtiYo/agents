import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { loadAgentsConfigDetailed, persistMigratedConfig, saveAgentsConfig } from './config.js'
import { loadResolvedRegistry } from './mcp.js'
import { writeManagedFile } from './managedFiles.js'
import { getProjectPaths } from './paths.js'
import { commandExists, runCommand } from './shell.js'
import { toManagedClaudeName } from '../integrations/claude.js'
import { INTEGRATION_SYNC_HOOKS } from '../integrations/syncHooks.js'
import { ensureProjectGitignore } from './gitignore.js'
import { syncSkills } from './skills.js'
import { syncClaudeInstructions } from './claudeInstructions.js'
import {
  getClaudeDesktopConfigPath,
  getClaudeDesktopConfigUnavailableDetail,
  getClaudeDesktopManagedPrefix,
  listClaudeDesktopManagedServerNames,
  mergeClaudeDesktopConfig,
  readClaudeDesktopConfig,
  toManagedClaudeDesktopName
} from './claudeDesktop.js'
import { computeSharedSourceFingerprint } from './sourceFingerprint.js'
import { syncVscodeSettings } from './vscodeSettings.js'
import { listCursorMcpStatuses } from './cursorCli.js'
import { listClaudeManagedServerNames } from './claudeCli.js'
import { renderClaudeDesktopMcp } from './renderers.js'
import { validateEnvKey, validateEnvValueForShell, validateHeaderKey, validateServerName } from './mcpValidation.js'
import { acquireSyncLock } from './syncLock.js'
import { planProjectMcp, syncProjectMcpFile } from './projectMcp.js'
import { collectUnsupportedFieldWarnings } from './fieldSupport.js'
import * as ui from './ui.js'
import type { AgentsConfig, IntegrationName, ResolvedMcpServer, SyncOptions, SyncResult } from '../types.js'

interface ClaudeState {
  managedNames: string[]
}

interface CursorState {
  managedNames: string[]
}

interface ClaudeDesktopState {
  managedNames: string[]
}

/**
 * Materialize every enabled integration from `.agents`.
 *
 * Holds the sync lock, migrates the schema when needed, applies the active profile,
 * renders each tool's format and writes atomically. With `check: true` nothing is
 * written and the result lists what a real run would change, which is what
 * `agents sync --check` reports as drift.
 */
export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { projectRoot, check, verbose, profile } = options
  const paths = getProjectPaths(projectRoot)
  const releaseLock = check ? null : await acquireSyncLock(paths.generatedSyncLock)
  try {
    const { config, migratedFrom } = await loadAgentsConfigDetailed(projectRoot)
    const sourceFingerprint = await computeSharedSourceFingerprint(projectRoot, config)
    const changed: string[] = []

    const migrationWarnings: string[] = []
    if (migratedFrom !== null) {
      // The file is under version control, so a check run has to report that a later
      // sync will rewrite it.
      changed.push('.agents/agents.json')
      if (check) {
        migrationWarnings.push(
          `.agents/agents.json is schema ${String(migratedFrom)}; running sync migrates it to ${String(config.schemaVersion)} and keeps a .bak copy.`,
        )
      } else {
        const backupPath = await persistMigratedConfig(projectRoot, config, migratedFrom)
        migrationWarnings.push(
          `Migrated .agents/agents.json from schema ${String(migratedFrom)} to ${String(config.schemaVersion)}; previous file kept at ${path.basename(backupPath)}.`,
        )
      }
    }

    const resolved = await loadResolvedRegistry(projectRoot, profile === undefined ? undefined : { profile })
    const warnings = [...migrationWarnings, ...resolved.warnings]
    if (resolved.missingRequiredEnv.length > 0) {
      warnings.push(`Skipped servers because required env vars are missing: ${resolved.missingRequiredEnv.join('; ')}`)
    }
    validateResolvedServers(resolved.serversByTarget)

    if (!check) {
      const gitignoreChanged = await ensureProjectGitignore(projectRoot, config.syncMode)
      if (gitignoreChanged) {
        changed.push('.gitignore')
      }
    }

    if (!check) {
      await ensureDir(paths.generatedDir)
    }

    const enabled = new Set(config.integrations.enabled)
    warnings.push(...collectUnsupportedFieldWarnings(resolved.serversByTarget, config.integrations.enabled))

    const generatedByIntegration: Partial<Record<IntegrationName, string>> = {}
    for (const hook of INTEGRATION_SYNC_HOOKS) {
      const generated = hook.buildGenerated(resolved.serversByTarget[hook.id])
      // Generated previews are written for every integration, but only the enabled
      // ones may warn: nobody needs Goose advice in a project without Goose.
      if (enabled.has(hook.id)) {
        warnings.push(...generated.warnings)
      }
      generatedByIntegration[hook.id] = generated.content
      await writeManagedFile({
        absolutePath: hook.generatedPath(paths),
        content: generated.content,
        projectRoot,
        check,
        changed
      })
    }

    const claudeDesktopGenerated = renderClaudeDesktopMcp(resolved.serversByTarget.claude_desktop, projectRoot)
    if (enabled.has('claude_desktop')) {
      warnings.push(...claudeDesktopGenerated.warnings)
    }
    generatedByIntegration.claude_desktop = `${JSON.stringify({ mcpServers: claudeDesktopGenerated.mcpServers }, null, 2)}\n`
    await writeManagedFile({
      absolutePath: paths.generatedClaudeDesktop,
      content: generatedByIntegration.claude_desktop,
      projectRoot,
      check,
      changed
    })

    for (const hook of INTEGRATION_SYNC_HOOKS) {
      if (!hook.materialize) continue
      const hookEnabled = enabled.has(hook.id)
      if (!hookEnabled && !hook.materializeWhenDisabled) continue
      if (hook.shouldMaterialize && !hook.shouldMaterialize(config)) continue
      await hook.materialize({
        projectRoot,
        paths,
        check,
        changed,
        warnings,
        config,
        generatedByIntegration,
        enabled: hookEnabled
      })
    }

    const claudeScope = config.integrations.options.claudeScope
    const projectMcpPlan = planProjectMcp({
      config,
      claudeEnabled: enabled.has('claude'),
      copilotCliEnabled: enabled.has('copilot_cli'),
      claudeServers: resolved.serversByTarget.claude,
      copilotServers: resolved.serversByTarget.copilot_cli,
      paths
    })

    await syncProjectMcpFile({
      plan: projectMcpPlan,
      statePath: paths.generatedProjectMcpState,
      generatedPath: paths.generatedClaudeProjectMcp,
      projectRoot,
      check,
      changed,
      warnings,
      knownServerNames: Object.keys(config.mcp.servers)
    })

    await syncClaude({
      // Project scope is a file, so the CLI path only runs when the user opted into local scope.
      // When switching from local to project, this still runs once with `enabled: false` to
      // remove the servers previously registered in ~/.claude.json.
      enabled: enabled.has('claude') && claudeScope === 'local',
      check,
      projectRoot,
      servers: resolved.serversByTarget.claude,
      statePath: paths.generatedClaudeState,
      changed,
      warnings
    })

    await syncClaudeDesktop({
      enabled: enabled.has('claude_desktop'),
      check,
      projectRoot,
      generatedContent: generatedByIntegration.claude_desktop ?? '',
      statePath: paths.generatedClaudeDesktopState,
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

    await syncClaudeInstructions({
      enabled: enabled.has('claude'),
      projectRoot,
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

    // Sync bookkeeping lives in .agents/generated (gitignored). Keeping it in the
    // committed config meant every teammate's sync produced a diff.
    const syncState = await readSyncState(paths.generatedSyncState, config)
    const previousSourceHash = syncState.lastSyncSourceHash
    const sourceStateChanged = sourceFingerprint !== previousSourceHash
    if (sourceStateChanged) {
      changed.push('.agents/generated/sync.state.json')
    }
    if (!check && sourceStateChanged) {
      // A config from before the hash existed keeps its timestamp: nothing changed,
      // the hash is simply being recorded for the first time.
      const adoptHashOnly = previousSourceHash === null && syncState.lastSync !== null
      await writeJsonAtomic(paths.generatedSyncState, {
        lastSync: adoptHashOnly ? syncState.lastSync : new Date().toISOString(),
        lastSyncSourceHash: sourceFingerprint
      })
    }

    // Older configs carried the same fields; move them to the state file once, so the
    // committed config settles and a later run does not report drift again.
    if (config.lastSync !== null || config.lastSyncSourceHash !== null) {
      if (!changed.includes('.agents/agents.json')) {
        changed.push('.agents/agents.json')
      }
      if (!check) {
        if (!sourceStateChanged && !(await pathExists(paths.generatedSyncState))) {
          await writeJsonAtomic(paths.generatedSyncState, {
            lastSync: config.lastSync,
            lastSyncSourceHash: config.lastSyncSourceHash
          })
        }
        config.lastSync = null
        config.lastSyncSourceHash = null
        await saveAgentsConfig(projectRoot, config)
      }
    }

    const sortedChanged = uniqueSorted(changed)
    if (verbose && sortedChanged.length > 0) {
      ui.info('Sync changed entries:')
      ui.arrowList(sortedChanged)
    }

    return {
      changed: sortedChanged,
      warnings: uniqueSorted(warnings)
    }
  } finally {
    if (releaseLock) {
      await releaseLock()
    }
  }
}

async function syncClaudeDesktop(args: {
  enabled: boolean
  check: boolean
  projectRoot: string
  generatedContent: string
  statePath: string
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, check, projectRoot, generatedContent, statePath, changed, warnings } = args
  const state = await readClaudeDesktopState(statePath)
  const configPath = getClaudeDesktopConfigPath()

  if (!configPath) {
    if (enabled) {
      warnings.push(getClaudeDesktopConfigUnavailableDetail())
    }
    return
  }
  if (!enabled && state.managedNames.length === 0) {
    if (!(await pathExists(configPath))) {
      return
    }
    try {
      const existingText = await readFile(configPath, 'utf8')
      if (!existingText.includes(getClaudeDesktopManagedPrefix(projectRoot))) {
        return
      }
    } catch {
      // Fall through to the locked read below so malformed or unreadable config
      // produces the same warning path as normal Claude Desktop sync.
    }
  }

  // Acquire global lock for Claude Desktop config to prevent race conditions across repos
  const claudeDesktopLockPath = path.join(path.dirname(configPath), '.claude_desktop_config.lock')
  const releaseLock = check ? null : await acquireSyncLock(claudeDesktopLockPath)
  try {
    let existing: Record<string, unknown> | undefined
    try {
      existing = await readClaudeDesktopConfig(configPath) as Record<string, unknown> | undefined
    } catch (error) {
      warnings.push(
        `Failed reading Claude Desktop config at ${configPath}; skipped Claude Desktop sync. ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    let managedServers: Record<string, unknown> = {}
    if (enabled) {
      try {
        const parsed = generatedContent.trim().length > 0
          ? JSON.parse(generatedContent) as { mcpServers?: Record<string, unknown> }
          : {}
        managedServers = typeof parsed.mcpServers === 'object' && parsed.mcpServers !== null && !Array.isArray(parsed.mcpServers)
          ? parsed.mcpServers
          : {}
      } catch (error) {
        warnings.push(`Failed parsing generated Claude Desktop config: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
    }

    if (!enabled && !existing) {
      if (!check) {
        await writeClaudeDesktopState(statePath, [])
      }
      return
    }

    const merged = mergeClaudeDesktopConfig({
      projectRoot,
      existing,
      managedServers
    })

    const existingManaged = existing
      ? listClaudeDesktopManagedServerNames(existing, projectRoot)
      : []

    if (!enabled && state.managedNames.length === 0 && existingManaged.length === 0) {
      return
    }

    if (!enabled && existingManaged.length === 0) {
      if (!check) {
        await writeClaudeDesktopState(statePath, [])
      }
      return
    }

    await writeManagedFile({
      absolutePath: configPath,
      content: `${JSON.stringify(merged, null, 2)}\n`,
      projectRoot,
      check,
      changed
    })
    if (!check) {
      await writeClaudeDesktopState(statePath, enabled ? Object.keys(managedServers) : [])
    }
  } finally {
    if (releaseLock) {
      await releaseLock()
    }
  }
}

async function readClaudeDesktopState(statePath: string): Promise<ClaudeDesktopState> {
  if (!(await pathExists(statePath))) return { managedNames: [] }
  try {
    const parsed = await readJson<ClaudeDesktopState>(statePath)
    return {
      managedNames: Array.isArray(parsed.managedNames)
        ? parsed.managedNames.filter((name): name is string => typeof name === 'string')
        : []
    }
  } catch {
    return { managedNames: [] }
  }
}

async function writeClaudeDesktopState(statePath: string, managedNames: string[]): Promise<void> {
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    managedNames: [...new Set(managedNames)].sort((a, b) => a.localeCompare(b))
  })
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

  if (!hasClaudeCli) {
    if (enabled) {
      warnings.push('Claude CLI not found; skipped Claude MCP sync.')
    }
    return
  }

  if (enabled) {
    const listed = listClaudeManagedServerNames(projectRoot, 'agents__', 5000)
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
  if (!hasCursorCli) {
    if (enabled && autoApprove) {
      warnings.push('Cursor CLI not found; skipped Cursor MCP approval sync.')
    }
    return
  }
  let namesNeedingApproval = new Set<string>()

  if (enabled && autoApprove) {
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

/** Reject server names, env keys and header names that a tool config must not carry. */
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

/** Deduplicate and sort a list for stable output. */
function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

interface SyncState {
  lastSync: string | null
  lastSyncSourceHash: string | null
}

/** Read the sync state, falling back to the fields older configs stored inline. */
async function readSyncState(statePath: string, config: AgentsConfig): Promise<SyncState> {
  if (await pathExists(statePath)) {
    try {
      const parsed = await readJson<Partial<SyncState>>(statePath)
      return {
        lastSync: typeof parsed.lastSync === 'string' ? parsed.lastSync : null,
        lastSyncSourceHash: typeof parsed.lastSyncSourceHash === 'string' ? parsed.lastSyncSourceHash : null
      }
    } catch {
      return { lastSync: null, lastSyncSourceHash: null }
    }
  }

  return {
    lastSync: config.lastSync ?? null,
    lastSyncSourceHash: config.lastSyncSourceHash ?? null
  }
}
