import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { lstat, readlink, readdir, rmdir } from 'node:fs/promises'
import { applyEdits as applyJsoncEdits, createScanner, modify as modifyJsonc, parse as parseJsonc, SyntaxKind } from 'jsonc-parser'
import { cleanupManagedGitignore } from '../core/gitignore.js'
import { readGooseDocument, readGooseExtensions, setGooseExtensions, writeGooseConfig } from '../core/goose.js'
import { getProjectPaths } from '../core/paths.js'
import type { ProjectPaths } from '../core/paths.js'
import { loadAgentsConfig } from '../core/config.js'
import { loadResolvedRegistry, resolveFromConfigAndLocal } from '../core/mcp.js'
import { INTEGRATIONS } from '../integrations/registry.js'
import { INTEGRATION_SYNC_HOOKS } from '../integrations/syncHooks.js'
import { toProjectScopedName } from '../core/globalScope.js'
import { readProjectMcpManagedNames } from '../core/projectMcp.js'
import {
  getWindsurfGlobalMcpPath,
  normalizeWindsurfMcpPayload,
  readWindsurfMcp,
  writeWindsurfMcp
} from '../core/windsurf.js'
import { pathExists, readJson, readTextOrEmpty, removeIfExists, writeJsonAtomic, writeTextAtomic } from '../core/fs.js'
import {
  isLegacyGeneratedCodexConfig,
  removeCodexManagedBlock,
  removeLegacyGeneratedCodexMcp
} from '../core/codexConfig.js'
import { syncClaude } from '../core/claudeSync.js'
import { cleanupManagedClaudeInstructions } from '../core/claudeInstructions.js'
import { cleanupManagedClaudeDesktopConfig } from '../core/claudeDesktop.js'
import { cleanupVscodeSettingsIfManaged } from '../core/vscodeSettings.js'
import { BRIDGE_MARKER_FILENAME, SKILL_BRIDGES } from '../core/skills.js'
import * as ui from '../core/ui.js'

export interface ResetOptions {
  projectRoot: string
  localOnly: boolean
  hard: boolean
}

/**
 * Performs a project reset by removing managed agent-related files and configuration according to the specified mode.
 *
 * In `hard` mode, removes all managed agent artifacts, Workspace/VS Code managed settings and managed `.gitignore` entries.
 * In `local-only` mode, removes workspace-local managed artifacts but keeps broader project-managed sources.
 * In the default (safe) mode, removes generated and workspace-managed artifacts while preserving source `.agents` files, root `AGENTS.md`, and managed `.gitignore` entries.
 *
 * @param options - Reset options:
 *   - `projectRoot`: root directory of the project to operate on
 *   - `localOnly`: when true, limit cleanup to workspace-local targets
 *   - `hard`: when true, perform the more destructive cleanup that removes additional config/state and managed `.gitignore` entries
 */
export async function runReset(options: ResetOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const paths = getProjectPaths(projectRoot)
  const legacyAgentDir = path.join(projectRoot, '.agent')

  const spin = ui.spinner()
  spin.start('Cleaning up...')

  const removed: string[] = []
  const warnings: string[] = []
  await syncClaude({
    enabled: false,
    scope: 'local',
    check: false,
    projectRoot,
    servers: [],
    statePath: paths.generatedClaudeState,
    changed: removed,
    warnings
  })
  const claudeDesktopCleanup = await cleanupManagedClaudeDesktopConfig(projectRoot)
  if (claudeDesktopCleanup.changed && claudeDesktopCleanup.path) {
    removed.push(claudeDesktopCleanup.path)
  }
  if (claudeDesktopCleanup.warning) {
    warnings.push(claudeDesktopCleanup.warning)
  }

  if (options.hard) {
    const vscodeSettingsRemoved = await cleanupVscodeSettingsIfManaged({
      settingsPath: paths.vscodeSettings,
      statePath: paths.generatedVscodeSettingsState
    })
    if (vscodeSettingsRemoved) {
      removed.push(path.relative(projectRoot, paths.vscodeSettings) || paths.vscodeSettings)
    }
  }

  await cleanupManagedClaudeInstructions({
    projectRoot,
    check: false,
    changed: removed,
  })

  await cleanupCodexConfig({
    projectRoot,
    configPath: paths.codexConfig,
    generatedPath: paths.generatedCodex,
    removed,
    warnings
  })
  await cleanupGeminiConfig({
    projectRoot,
    configPath: paths.geminiSettings,
    generatedPath: paths.generatedGemini,
    statePath: paths.generatedGeminiState,
    removed,
    warnings
  })
  await cleanupOpencodeConfig({
    projectRoot,
    configPath: paths.opencodeConfig,
    generatedPath: paths.generatedOpencode,
    statePath: paths.generatedOpencodeState,
    removed,
    warnings
  })
  await cleanupGrokConfig({
    projectRoot,
    configPath: paths.grokConfig,
    generatedPath: paths.generatedGrok,
    removed,
    warnings
  })
  // Every integration whose managed servers live under one key of a JSON or JSONC
  // document is cleaned from the registry, so a new one of that shape needs no entry
  // here. The formats with a managed block or their own document keep their routines.
  for (const integration of INTEGRATIONS) {
    const descriptor = integration.config
    const managed = descriptor?.managedEntries
    if (!descriptor || !managed) continue
    await cleanupKeyedJsonConfig(
      {
        projectRoot,
        configPath: paths[descriptor.pathKey],
        generatedPath: paths[managed.generatedPathKey],
        statePath: paths[managed.statePathKey],
        removed,
        warnings
      },
      managed.shortLabel,
      managed.key,
      descriptor.format === 'jsonc' ? { jsonc: true } : undefined,
    )
  }

  await cleanupGooseConfig({
    projectRoot,
    configPath: paths.gooseConfig,
    statePath: paths.generatedGooseState,
    removed,
    warnings
  })
  await cleanupWindsurfGlobalConfig({
    projectRoot,
    configPath: getWindsurfGlobalMcpPath(),
    statePath: paths.generatedWindsurfState,
    removed,
    warnings
  })
  await cleanupProjectMcpFiles({
    projectRoot,
    paths,
    removed,
    warnings
  })

  const bridges = [
    ...SKILL_BRIDGES.map((bridge) => ({ bridgePath: paths[bridge.pathKey], sourcePath: paths.agentsSkillsDir })),
    { bridgePath: path.join(legacyAgentDir, 'skills'), sourcePath: paths.agentsSkillsDir }
  ]
  for (const bridge of bridges) {
    if (!(await isManagedSkillBridge(bridge.bridgePath, bridge.sourcePath))) continue
    await removeResetTarget(bridge.bridgePath, projectRoot, removed)
  }

  await cleanupKeyedJsonConfig({
    projectRoot,
    configPath: paths.antigravityProjectMcp,
    generatedPath: paths.generatedAntigravity,
    removed,
    warnings
  }, 'legacy Antigravity', 'mcpServers')

  const targets: string[] = []
  if (!options.localOnly) {
    targets.push(paths.generatedDir)
  }
  if (options.hard) {
    targets.push(paths.agentsDir, paths.rootAgentsMd)
  }

  for (const target of targets) {
    await removeResetTarget(target, projectRoot, removed)
  }

  if (options.hard) {
    const gitignoreChanged = await cleanupManagedGitignore(projectRoot)
    if (gitignoreChanged) {
      removed.push('.gitignore (managed agents entries)')
    }
  }

  spin.stop('Cleanup complete')

  for (const warning of warnings) {
    ui.warning(warning)
  }

  if (removed.length === 0) {
    ui.info('Reset: nothing to clean')
    return
  }

  const mode = options.hard ? 'hard' : options.localOnly ? 'local-only' : 'safe'
  ui.success(`Reset (${mode}) cleaned ${removed.length} path(s):`)
  ui.arrowList(removed)

  if (!options.hard && !options.localOnly) {
    ui.blank()
    ui.hint('Safe reset keeps .agents source files, root AGENTS.md, and managed .gitignore entries. Use --hard to remove all agents-managed setup.')
  }
}

/** Remove only agents-managed Gemini fields while preserving unrelated user settings. */
async function cleanupGeminiConfig(args: JsonConfigCleanupArgs): Promise<void> {
  const existing = await readConfigObjectForCleanup(args.configPath, 'Gemini', args.warnings)
  if (existing === null) return
  if (Object.keys(existing).length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  const generated = await readGeneratedObjectForCleanup(args, 'Gemini')
  if (generated === null) return

  const cleaned = { ...existing }
  const existingContext = isRecord(existing.context) ? { ...existing.context } : null
  const generatedContext = isRecord(generated.context) ? generated.context : null
  if (existingContext && generatedContext && existingContext.fileName === generatedContext.fileName) {
    delete existingContext.fileName
    if (Object.keys(existingContext).length === 0) {
      delete cleaned.context
    } else {
      cleaned.context = existingContext
    }
  }
  if (cleaned.contextFileName === generated.contextFileName) {
    delete cleaned.contextFileName
  }
  await removeManagedMapEntries(args, cleaned, generated, 'mcpServers')

  await persistCleanedJsonConfig(args, existing, cleaned)
}

/** Remove only agents-managed OpenCode MCP entries while preserving unrelated settings. */
async function cleanupOpencodeConfig(args: JsonConfigCleanupArgs): Promise<void> {
  const existing = await readConfigObjectForCleanup(args.configPath, 'OpenCode', args.warnings)
  if (existing === null) return
  if (Object.keys(existing).length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  const generated = await readGeneratedObjectForCleanup(args, 'OpenCode')
  if (generated === null) return

  const cleaned = { ...existing }
  await removeManagedMapEntries(args, cleaned, generated, 'mcp')
  await persistCleanedJsonConfig(args, existing, cleaned)
}

interface JsonConfigCleanupArgs {
  projectRoot: string
  configPath: string
  generatedPath: string
  statePath?: string
  removed: string[]
  warnings: string[]
}

/** Read a materialized JSON object for reset, preserving malformed or non-object files. */
async function readConfigObjectForCleanup(
  configPath: string,
  label: string,
  warnings: string[],
): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(configPath))) return null
  try {
    const parsed = await readJson<unknown>(configPath)
    if (!isRecord(parsed)) {
      warnings.push(`Failed to clean managed ${label} settings from ${configPath}; preserved the non-object JSON file.`)
      return null
    }
    return parsed
  } catch (error) {
    warnings.push(
      `Failed to clean managed ${label} settings from ${configPath}; preserved the file. ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** Read a preview when available, without making it a prerequisite for applied ownership. */
async function readGeneratedObjectForCleanup(
  args: JsonConfigCleanupArgs,
  label: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await readJson<unknown>(args.generatedPath)
    if (isRecord(parsed)) return parsed
  } catch {
    // A preview is disposable; the applied ownership record remains authoritative.
  }
  if (args.statePath && await pathExists(args.statePath)) return {}

  // A commit-generated clone has configs but no local preview/state. Reconstruct
  // only the selected public definition, then require a structural content match.
  try {
    const config = await loadAgentsConfig(args.projectRoot)
    const paths = getProjectPaths(args.projectRoot)
    const hook = INTEGRATION_SYNC_HOOKS.find(item => item.generatedPath(paths) === args.generatedPath)
    if (config.syncMode === 'commit-generated' && hook && config.integrations.enabled.includes(hook.id)) {
      const resolved = resolveFromConfigAndLocal({
        projectRoot: args.projectRoot,
        servers: Object.fromEntries(Object.entries(config.mcp.servers).map(([name, server]) => [name, { ...server, requiredEnv: [] }])),
        local: { mcpServers: {} },
        profile: config.activeProfile ? config.profiles?.[config.activeProfile] : undefined
      })
      const generated: unknown = JSON.parse(hook.buildGenerated(resolved.publicServersByTarget[hook.id]).content)
      if (isRecord(generated)) return generated
    }
  } catch {
    // Unknown source definitions cannot establish ownership.
  }
  args.warnings.push(`Could not identify managed ${label} settings because ${args.generatedPath} is unavailable; preserved the config file.`)
  return null
}

/** Remove generated map keys from a materialized JSON object without touching unknown entries. */
async function removeManagedMapEntries(
  args: JsonConfigCleanupArgs,
  cleaned: Record<string, unknown>,
  generated: Record<string, unknown>,
  key: string,
): Promise<void> {
  if (!isRecord(cleaned[key])) return
  const remaining = { ...cleaned[key] }
  let managedNames: string[]
  if (args.statePath && await pathExists(args.statePath)) {
    try {
      const state = await readJson<{ managedNames?: unknown }>(args.statePath)
      if (!Array.isArray(state.managedNames) || !state.managedNames.every(name => typeof name === 'string')) {
        throw new Error('Invalid managedNames')
      }
      managedNames = state.managedNames
    } catch {
      args.warnings.push(`Could not read ownership at ${args.statePath}; preserved MCP entries.`)
      return
    }
  } else {
    // A preview is generated for disabled integrations too. Only matching content
    // can identify legacy ownership when no applied-state record exists.
    const preview = isRecord(generated[key]) ? generated[key] : {}
    managedNames = Object.keys(preview).filter(name =>
      isDeepStrictEqual(remaining[name], preview[name]))
  }
  for (const managedName of managedNames) {
    delete remaining[managedName]
  }
  if (Object.keys(remaining).length === 0) {
    delete cleaned[key]
  } else {
    cleaned[key] = remaining
  }
}

/** Persist a cleaned JSON config or remove it when no user-owned fields remain. */
async function persistCleanedJsonConfig(
  args: JsonConfigCleanupArgs,
  existing: Record<string, unknown>,
  cleaned: Record<string, unknown>,
): Promise<void> {
  if (JSON.stringify(cleaned) === JSON.stringify(existing)) return
  if (Object.keys(cleaned).length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }
  await writeJsonAtomic(args.configPath, cleaned)
  args.removed.push(path.relative(args.projectRoot, args.configPath) || args.configPath)
}

/** Return whether a value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Remove the agents-managed Codex block while preserving user-owned TOML. */
async function cleanupCodexConfig(args: {
  projectRoot: string
  configPath: string
  generatedPath: string
  removed: string[]
  warnings: string[]
}): Promise<void> {
  if (!(await pathExists(args.configPath))) return

  try {
    const existing = await readTextOrEmpty(args.configPath)
    let cleaned = removeCodexManagedBlock(existing)
    if (cleaned === existing && isLegacyGeneratedCodexConfig(existing)) {
      const generated = await readTextOrEmpty(args.generatedPath)
      if (generated === existing) {
        cleaned = ''
      } else {
        cleaned = removeLegacyGeneratedCodexMcp(existing)
      }
    }

    if (cleaned === existing) return
    if (cleaned.trim().length === 0) {
      await removeResetTarget(args.configPath, args.projectRoot, args.removed)
      return
    }

    await writeTextAtomic(args.configPath, cleaned)
    args.removed.push(path.relative(args.projectRoot, args.configPath) || args.configPath)
  } catch (error) {
    args.warnings.push(
      `Failed to clean managed Codex MCP from ${args.configPath}; preserved the file. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Remove one reset target and prune empty parent directories inside the project. */
async function removeResetTarget(target: string, projectRoot: string, removed: string[]): Promise<void> {
  if (!(await pathExists(target))) return
  await removeIfExists(target)
  removed.push(path.relative(projectRoot, target) || target)
  await removeEmptyParents(path.dirname(target), projectRoot)
}

/** Remove empty parent directories while tolerating expected concurrent filesystem changes. */
async function removeEmptyParents(startPath: string, projectRoot: string): Promise<void> {
  let current = startPath
  const rootPrefix = `${projectRoot}${path.sep}`
  while (current.startsWith(rootPrefix) && current !== projectRoot) {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return
    }
    if (entries.length > 0) return
    try {
      await rmdir(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTEMPTY') return
      throw error
    }
    current = path.dirname(current)
  }
}

/** Return whether a skill bridge is an agents-managed symlink or marked copy. */
async function isManagedSkillBridge(bridgePath: string, sourcePath: string): Promise<boolean> {
  if (!(await pathExists(bridgePath))) return false

  let info
  try {
    info = await lstat(bridgePath)
  } catch {
    return false
  }

  if (info.isSymbolicLink()) {
    try {
      const current = await readlink(bridgePath)
      const expected = path.relative(path.dirname(bridgePath), sourcePath) || '.'
      return current === expected || path.resolve(path.dirname(bridgePath), current) === sourcePath
    } catch {
      return false
    }
  }

  return info.isDirectory() && await pathExists(path.join(bridgePath, BRIDGE_MARKER_FILENAME))
}

/** Strip the agents-managed MCP block from a Grok project config, keeping user sections. */
async function cleanupGrokConfig(args: {
  projectRoot: string
  configPath: string
  generatedPath: string
  removed: string[]
  warnings: string[]
}): Promise<void> {
  if (!(await pathExists(args.configPath))) return

  const existing = await readTextOrEmpty(args.configPath)
  let cleaned: string
  try {
    cleaned = removeCodexManagedBlock(existing)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.warnings.push(`Failed to clean Grok config at ${args.configPath}: ${message}`)
    return
  }

  // Nothing of ours in the file means nothing to clean, even if the file is blank.
  if (cleaned === existing) return

  if (cleaned.trim().length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  await writeTextAtomic(args.configPath, cleaned)
  args.removed.push(path.relative(args.projectRoot, args.configPath) || args.configPath)
}

/**
 * Remove the agents-managed entries from one top-level key of a shared JSON settings
 * file (Amp, Zed, Kilo), deleting the file only when nothing else is left in it.
 */
async function cleanupKeyedJsonConfig(
  args: JsonConfigCleanupArgs,
  label: string,
  key: string,
  options?: { jsonc?: boolean },
): Promise<void> {
  const existing = options?.jsonc
    ? await readJsoncObjectForCleanup(args.configPath, label, args.warnings)
    : await readConfigObjectForCleanup(args.configPath, label, args.warnings)
  if (existing === null) return
  if (Object.keys(existing).length === 0) {
    if (options?.jsonc && hasJsoncComments(await readTextOrEmpty(args.configPath))) return
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  const generated = await readGeneratedObjectForCleanup(args, label)
  if (generated === null) return

  const cleaned = { ...existing }
  await removeManagedMapEntries(args, cleaned, generated, key)

  if (options?.jsonc) {
    await persistCleanedJsoncConfig(args, existing, cleaned, key)
    return
  }
  await persistCleanedJsonConfig(args, existing, cleaned)
}

/** Rewrite one key of a JSONC file, so the user's comments and formatting survive. */
async function persistCleanedJsoncConfig(
  args: JsonConfigCleanupArgs,
  existing: Record<string, unknown>,
  cleaned: Record<string, unknown>,
  key: string,
): Promise<void> {
  if (JSON.stringify(cleaned) === JSON.stringify(existing)) return
  const raw = await readTextOrEmpty(args.configPath)
  if (Object.keys(cleaned).length === 0 && !hasJsoncComments(raw)) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  // Deleting a property can consume the leading comments attached to it. An empty
  // server map keeps those comments without leaving any managed entries active.
  const value = cleaned[key] === undefined && hasJsoncComments(raw) ? {} : cleaned[key]
  const edits = modifyJsonc(raw, [key], value, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  })
  const applied = applyJsoncEdits(raw, edits)
  if (applied === raw) return
  await writeTextAtomic(args.configPath, applied.endsWith('\n') ? applied : `${applied}\n`)
  args.removed.push(path.relative(args.projectRoot, args.configPath) || args.configPath)
}

/** Comments remain user content even when a JSONC object has no active settings. */
function hasJsoncComments(raw: string): boolean {
  const scanner = createScanner(raw)
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) return true
  }
  return false
}

/** Read a JSONC settings file for cleanup, tolerating comments and trailing commas. */
async function readJsoncObjectForCleanup(
  configPath: string,
  label: string,
  warnings: string[],
): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(configPath))) return null

  const raw = await readTextOrEmpty(configPath)
  if (raw.trim().length === 0) return {}

  const errors: { error: number; offset: number; length: number }[] = []
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true }) as unknown
  if (errors.length > 0 || (parsed !== undefined && !isRecord(parsed))) {
    warnings.push(`Existing ${label} config at ${configPath} is not valid JSONC; preserved the file.`)
    return null
  }
  return isRecord(parsed) ? parsed : {}
}

/** Remove the extensions agents added to the global Goose config, keeping the rest. */
/**
 * Remove this project's servers from the global Windsurf config.
 *
 * The file lives in the home directory and is shared with every other project, so only
 * the entries recorded in the state file are touched. `reset` deletes
 * `.agents/generated` afterwards, so without this the owner of those entries would be
 * lost and no later sync could remove them.
 */
async function cleanupWindsurfGlobalConfig(args: {
  projectRoot: string
  configPath: string
  statePath: string
  removed: string[]
  warnings: string[]
}): Promise<void> {
  if (!(await pathExists(args.configPath))) return

  let managedNames: string[] = []
  if (await pathExists(args.statePath)) {
    try {
      const state = await readJson<{ managedNames?: unknown }>(args.statePath)
      // The file is under .agents/generated, which a repository can carry. Only names
      // carrying this project may be removed from a config shared with every other one.
      const scopePrefix = toProjectScopedName(args.projectRoot, '')
      managedNames = Array.isArray(state.managedNames)
        ? state.managedNames.filter(
            (name): name is string => typeof name === 'string' && name.startsWith(scopePrefix),
          )
        : []
    } catch {
      managedNames = []
    }
  }

  // A clone has no state file; fall back to the servers this project would have written,
  // resolved the way the sync resolves them.
  if (managedNames.length === 0) {
    try {
      const resolved = await loadResolvedRegistry(args.projectRoot)
      managedNames = resolved.serversByTarget.windsurf.map((server) =>
        toProjectScopedName(args.projectRoot, server.name),
      )
    } catch {
      managedNames = []
    }
  }
  if (managedNames.length === 0) return

  let payload
  try {
    payload = await readWindsurfMcp(args.configPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.warnings.push(`Failed to read Windsurf config at ${args.configPath}: ${message}`)
    return
  }
  if (!payload) return

  const servers = { ...(payload.mcpServers ?? {}) }
  let changed = false
  for (const name of managedNames) {
    if (name in servers) {
      delete servers[name]
      changed = true
    }
  }
  if (!changed) return

  const rest = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'mcpServers'))
  // A file that held nothing but this project's servers was created by this CLI.
  if (Object.keys(servers).length === 0 && Object.keys(rest).length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  await writeWindsurfMcp(args.configPath, normalizeWindsurfMcpPayload({ ...rest, mcpServers: servers }))
  args.removed.push(args.configPath)
}

async function cleanupGooseConfig(args: {
  projectRoot: string
  configPath: string
  statePath: string
  removed: string[]
  warnings: string[]
}): Promise<void> {
  if (!(await pathExists(args.configPath))) return

  let managedNames: string[] = []
  if (await pathExists(args.statePath)) {
    try {
      const state = await readJson<{ managedNames?: unknown }>(args.statePath)
      // The file is under .agents/generated, which a repository can carry. Only names
      // carrying this project may be removed from a config shared with every other one.
      const scopePrefix = toProjectScopedName(args.projectRoot, '')
      managedNames = Array.isArray(state.managedNames)
        ? state.managedNames.filter(
            (name): name is string => typeof name === 'string' && name.startsWith(scopePrefix),
          )
        : []
    } catch {
      managedNames = []
    }
  }

  // .agents/generated is gitignored, so a clone has no state. Fall back to the servers
  // that would have been written for Goose, resolved exactly as the sync resolves them:
  // taking every configured server could delete a user's own extension of the same name.
  if (managedNames.length === 0) {
    try {
      const resolved = await loadResolvedRegistry(args.projectRoot)
      // Only the scoped names. A bare entry under the same name is not this project's
      // by definition, and deleting it here would take the user's own extension with it.
      managedNames = resolved.serversByTarget.goose.map((server) =>
        toProjectScopedName(args.projectRoot, server.name),
      )
    } catch {
      managedNames = []
    }
  }
  if (managedNames.length === 0) return

  let doc
  try {
    doc = await readGooseDocument(args.configPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    args.warnings.push(`Failed to read Goose config at ${args.configPath}: ${message}`)
    return
  }

  const extensions = { ...readGooseExtensions(doc) }
  let changed = false
  for (const name of managedNames) {
    if (name in extensions) {
      delete extensions[name]
      changed = true
    }
  }
  if (!changed) return

  const content = setGooseExtensions(doc, extensions)
  if (content.trim().length === 0) {
    await removeResetTarget(args.configPath, args.projectRoot, args.removed)
    return
  }

  await writeGooseConfig(args.configPath, content)
  args.removed.push(args.configPath)
}

/**
 * Clean `.mcp.json` and `.github/mcp.json`.
 *
 * The managed names come from the sync state; a project synced by 0.8.x has none, and
 * that release rewrote the file wholesale, so the servers named in agents.json are used
 * instead. Servers added by hand are always kept.
 */
async function cleanupProjectMcpFiles(args: {
  projectRoot: string
  paths: ProjectPaths
  removed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, paths, removed, warnings } = args

  const hasState = await pathExists(paths.generatedProjectMcpState)
  const managedByFile = await readProjectMcpManagedNames(paths.generatedProjectMcpState, projectRoot)
  let fallbackNames: string[] = []
  try {
    const config = await loadAgentsConfig(projectRoot)
    fallbackNames = Object.keys(config.mcp.servers)
  } catch {
    fallbackNames = []
  }

  for (const targetPath of [paths.copilotCliMcp, paths.copilotCliGithubMcp]) {
    if (!(await pathExists(targetPath))) continue

    const managedNames = managedByFile[targetPath] ?? (hasState ? [] : fallbackNames)

    let parsed: unknown
    try {
      parsed = await readJson<unknown>(targetPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Failed to read ${targetPath}; preserved the file. ${message}`)
      continue
    }
    if (!isRecord(parsed)) continue

    const servers = isRecord(parsed.mcpServers) ? { ...parsed.mcpServers } : {}
    let changed = false
    for (const name of managedNames) {
      if (name in servers) {
        delete servers[name]
        changed = true
      }
    }

    const otherKeys = Object.keys(parsed).filter((key) => key !== 'mcpServers')
    // A file with nothing left in it is removed even when no managed name matched:
    // it holds no configuration for anyone.
    if (!changed && !(Object.keys(servers).length === 0 && otherKeys.length === 0)) continue
    if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
      await removeResetTarget(targetPath, projectRoot, removed)
      continue
    }

    await writeJsonAtomic(targetPath, { ...parsed, mcpServers: servers })
    removed.push(path.relative(projectRoot, targetPath) || targetPath)
  }
}
