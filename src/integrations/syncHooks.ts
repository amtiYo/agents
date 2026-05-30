import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from '../core/fs.js'
import { writeManagedFile } from '../core/managedFiles.js'
import { getLegacyAntigravityGlobalMcpPath, normalizeAntigravityMcpPayload, readAntigravityMcp } from '../core/antigravity.js'
import { getWindsurfGlobalMcpPath, normalizeWindsurfMcpPayload, readWindsurfMcp } from '../core/windsurf.js'
import { normalizeOpencodeConfig } from '../core/opencode.js'
import { renderVscodeMcp } from '../core/renderers.js'
import { acquireSyncLock } from '../core/syncLock.js'
import { buildAntigravityPayload } from './antigravity.js'
import { buildCodexConfig } from './codex.js'
import { buildCopilotCliPayload } from './copilotCli.js'
import { buildVscodeMcpPayload } from './copilotVscode.js'
import { buildCursorPayload } from './cursor.js'
import { buildGeminiPayload } from './gemini.js'
import { buildOpencodePayload } from './opencode.js'
import { buildWindsurfPayload } from './windsurf.js'
import { buildJuniePayload } from './junie.js'
import type { ProjectPaths } from '../core/paths.js'
import type { AgentsConfig, IntegrationName, ResolvedMcpServer } from '../types.js'

interface BuildGeneratedResult {
  content: string
  warnings: string[]
}

interface HookContext {
  projectRoot: string
  paths: ProjectPaths
  check: boolean
  changed: string[]
  warnings: string[]
  config: AgentsConfig
  generatedByIntegration: Partial<Record<IntegrationName, string>>
  enabled: boolean
}

export interface IntegrationSyncHook {
  id: IntegrationName
  generatedPath: (paths: ProjectPaths) => string
  buildGenerated: (servers: ResolvedMcpServer[]) => BuildGeneratedResult
  shouldMaterialize?: (config: AgentsConfig) => boolean
  materializeWhenDisabled?: boolean
  materialize?: (context: HookContext) => Promise<void>
}

export const INTEGRATION_SYNC_HOOKS: IntegrationSyncHook[] = [
  {
    id: 'codex',
    generatedPath: (paths) => paths.generatedCodex,
    buildGenerated: (servers) => {
      const codex = buildCodexConfig(servers)
      return {
        content: codex.content,
        warnings: codex.warnings
      }
    },
    materialize: async (context) => {
      const content = context.generatedByIntegration.codex ?? ''
      const targetPath = context.paths.codexConfig
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'gemini',
    generatedPath: (paths) => paths.generatedGemini,
    buildGenerated: (servers) => {
      const gemini = buildGeminiPayload(servers)
      return {
        content: `${JSON.stringify(gemini.payload, null, 2)}\n`,
        warnings: gemini.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.geminiSettings
      const rawGenerated = context.generatedByIntegration.gemini ?? ''
      let generated: Record<string, unknown> = {}
      if (rawGenerated.trim()) {
        generated = parseJsonObject(rawGenerated, 'generated Gemini config')
      }

      let existing: Record<string, unknown> = {}
      if (await pathExists(targetPath)) {
        try {
          existing = await readJson<Record<string, unknown>>(targetPath)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          context.warnings.push(`Failed to read existing Gemini config at ${targetPath}; starting fresh. ${message}`)
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

      await writeManagedFile({
        absolutePath: targetPath,
        content: `${JSON.stringify(merged, null, 2)}\n`,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'copilot_vscode',
    generatedPath: (paths) => paths.generatedCopilot,
    buildGenerated: (servers) => {
      const copilot = buildVscodeMcpPayload(servers)
      return {
        content: `${JSON.stringify(copilot.payload, null, 2)}\n`,
        warnings: copilot.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.vscodeMcp
      const content = context.generatedByIntegration.copilot_vscode ?? ''
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'copilot_cli',
    generatedPath: (paths) => paths.generatedCopilotCli,
    buildGenerated: (servers) => {
      const copilot = buildCopilotCliPayload(servers)
      return {
        content: `${JSON.stringify(copilot.payload, null, 2)}\n`,
        warnings: copilot.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.copilotCliMcp
      const content = context.generatedByIntegration.copilot_cli ?? ''
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'cursor',
    generatedPath: (paths) => paths.generatedCursor,
    buildGenerated: (servers) => {
      const cursor = buildCursorPayload(servers)
      return {
        content: `${JSON.stringify(cursor.payload, null, 2)}\n`,
        warnings: cursor.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.cursorMcp
      const content = context.generatedByIntegration.cursor ?? ''
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'antigravity',
    generatedPath: (paths) => paths.generatedAntigravity,
    buildGenerated: (servers) => {
      const antigravity = buildAntigravityPayload(servers)
      return {
        content: `${JSON.stringify(antigravity.payload, null, 2)}\n`,
        warnings: antigravity.warnings
      }
    },
    materializeWhenDisabled: true,
    materialize: async (context) => {
      const rawGenerated = context.generatedByIntegration.antigravity ?? ''
      const legacyProjectPath = context.paths.antigravityProjectMcp
      const legacyGlobalPath = getLegacyAntigravityGlobalMcpPath()
      const mcpSyncEnabled = context.config.integrations.options.antigravityGlobalSync !== false

      const legacyExists = await pathExists(legacyProjectPath)
      if (context.enabled && mcpSyncEnabled && legacyExists) {
        context.warnings.push('Found legacy .antigravity/mcp.json. Antigravity now uses .agents/mcp_config.json for workspace MCP.')
      }

      const previousManagedNames = await readManagedGlobalNames(context.paths.generatedAntigravityState)
      await cleanupLegacyAntigravityGlobal({
        globalPath: legacyGlobalPath,
        previousManagedNames,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed,
        warnings: context.warnings
      })

      await syncManagedAntigravityWorkspace({
        enabled: context.enabled && mcpSyncEnabled,
        workspacePath: context.paths.antigravityWorkspaceMcp,
        statePath: context.paths.generatedAntigravityState,
        rawGenerated,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed,
        warnings: context.warnings
      })
    }
  },
  {
    id: 'windsurf',
    generatedPath: (paths) => paths.generatedWindsurf,
    buildGenerated: (servers) => {
      const windsurf = buildWindsurfPayload(servers)
      return {
        content: `${JSON.stringify(windsurf.payload, null, 2)}\n`,
        warnings: windsurf.warnings
      }
    },
    materializeWhenDisabled: true,
    materialize: async (context) => {
      const rawGenerated = context.generatedByIntegration.windsurf ?? ''
      const globalPath = getWindsurfGlobalMcpPath()

      await syncManagedWindsurfGlobal({
        enabled: context.enabled,
        globalPath,
        statePath: context.paths.generatedWindsurfState,
        rawGenerated,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed,
        warnings: context.warnings
      })
    }
  },
  {
    id: 'opencode',
    generatedPath: (paths) => paths.generatedOpencode,
    buildGenerated: (servers) => {
      const opencode = buildOpencodePayload(servers)
      return {
        content: `${JSON.stringify(opencode.payload, null, 2)}\n`,
        warnings: opencode.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.opencodeConfig
      const rawGenerated = context.generatedByIntegration.opencode ?? ''

      let generated: Record<string, unknown> = {}
      if (rawGenerated.trim()) {
        generated = parseJsonObject(rawGenerated, 'generated OpenCode config')
      }

      let existing: Record<string, unknown> = {}
      if (await pathExists(targetPath)) {
        try {
          existing = await readJson<Record<string, unknown>>(targetPath)
        } catch (error) {
          context.warnings.push(
            `Failed to read existing OpenCode config at ${targetPath}; starting fresh. ${error instanceof Error ? error.message : String(error)}`,
          )
          existing = {}
        }
      }

      const generatedMcp = typeof generated.mcp === 'object' && generated.mcp !== null && !Array.isArray(generated.mcp)
        ? generated.mcp as Record<string, unknown>
        : {}

      const merged = normalizeOpencodeConfig({
        ...existing,
        mcp: generatedMcp
      })

      await writeManagedFile({
        absolutePath: targetPath,
        content: `${JSON.stringify(merged, null, 2)}\n`,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'junie',
    generatedPath: (paths) => paths.generatedJunie,
    buildGenerated: (servers) => {
      const junie = buildJuniePayload(servers)
      return {
        content: `${JSON.stringify(junie.payload, null, 2)}\n`,
        warnings: junie.warnings
      }
    },
    materialize: async (context) => {
      if (!context.check) {
        await ensureDir(context.paths.junieMcpDir)
      }
      await writeManagedFile({
        absolutePath: context.paths.junieMcp,
        content: context.generatedByIntegration.junie ?? '{}',
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'claude',
    generatedPath: (paths) => paths.generatedClaude,
    buildGenerated: (servers) => {
      const claude = renderVscodeMcp(servers)
      return {
        content: `${JSON.stringify({ mcpServers: claude.servers }, null, 2)}\n`,
        warnings: claude.warnings
      }
    }
  }
]

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface ManagedGlobalState {
  managedNames: string[]
}

/**
 * Update the workspace Antigravity MCP file with the set of managed servers derived from the generated config and persist the list of managed server names.
 *
 * Reads the previous managed server names from `statePath`, merges them with the newly generated servers (removing any previously-managed entries that are no longer produced), writes the resulting MCP JSON to `workspacePath`, and updates the state file with the current managed server names. Operates in a no-op mode when `check` is true (no files are modified) but still computes warnings and records changed paths.
 *
 * @param enabled - Whether the integration is enabled; if false, generated servers are not applied but previously-managed names will be removed.
 * @param workspacePath - Absolute path to the workspace Antigravity MCP file to read and write.
 * @param statePath - Path to the JSON file that tracks previously-managed server names.
 * @param rawGenerated - Raw generated Antigravity MCP JSON produced by the integration (may be empty or whitespace).
 * @param projectRoot - Repository root used for recording relative changes when writing managed files.
 * @param check - If true, perform a dry run: compute changes and warnings without modifying files.
 * @param changed - Mutable array to which paths of files that would be or were changed will be appended.
 * @param warnings - Mutable array to which human-readable warning messages will be appended.
 */
async function syncManagedAntigravityWorkspace(args: {
  enabled: boolean
  workspacePath: string
  statePath: string
  rawGenerated: string
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const previousNames = await readManagedGlobalNames(args.statePath)
  if (!args.enabled && previousNames.length === 0) return

  const lockPath = path.join(path.dirname(args.workspacePath), '.agents-antigravity-mcp.lock')
  const releaseLock = args.check ? null : await acquireSyncLock(lockPath)
  try {
    let existing: Record<string, unknown> = {}
    if (await pathExists(args.workspacePath)) {
      try {
        existing = normalizeAntigravityMcpPayload(await readAntigravityMcp(args.workspacePath) ?? {})
      } catch (error) {
        args.warnings.push(
          `Failed to read existing Antigravity MCP at ${args.workspacePath}; skipped Antigravity workspace sync. ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
    }

    const generated = args.enabled && args.rawGenerated.trim().length > 0
      ? normalizeAntigravityMcpPayload(parseJsonObject(args.rawGenerated, 'generated Antigravity config'))
      : normalizeAntigravityMcpPayload({})
    const managedServers = recordFrom(generated.mcpServers)
    const existingServers = recordFrom(existing.mcpServers)
    const nextServers = mergeManagedServers(existingServers, previousNames, managedServers)
    const nextPayload = normalizeAntigravityMcpPayload({
      ...existing,
      mcpServers: nextServers
    })

    await writeManagedFile({
      absolutePath: args.workspacePath,
      content: `${JSON.stringify(nextPayload, null, 2)}\n`,
      projectRoot: args.projectRoot,
      check: args.check,
      changed: args.changed
    })

    if (!args.check) {
      await writeManagedGlobalNames(args.statePath, args.enabled ? Object.keys(managedServers) : [])
    }
  } finally {
    if (releaseLock) await releaseLock()
  }
}

/**
 * Remove previously-managed Antigravity MCP servers from a legacy global MCP file if it exists.
 *
 * Reads the legacy global MCP at `globalPath`, removes any servers whose names are listed in
 * `previousManagedNames`, and writes the updated MCP back to `globalPath`. If the legacy file
 * cannot be read or parsed, a warning is appended to `warnings` and no changes are written.
 *
 * @param globalPath - Absolute path to the legacy global Antigravity MCP file to update
 * @param previousManagedNames - Server names previously managed by this tool that should be removed
 * @param projectRoot - Repository root used when writing the managed file metadata
 * @param check - When true, operate in dry-run mode (do not acquire locks or persist changes)
 * @param changed - Mutable list that will be updated with paths that were or would be changed
 * @param warnings - Mutable list to which human-readable warning messages are appended on error
 */
async function cleanupLegacyAntigravityGlobal(args: {
  globalPath: string
  previousManagedNames: string[]
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  if (args.previousManagedNames.length === 0) return
  if (!(await pathExists(args.globalPath))) return

  const lockPath = path.join(path.dirname(args.globalPath), '.agents-antigravity-legacy-mcp.lock')
  const releaseLock = args.check ? null : await acquireSyncLock(lockPath)
  try {
    let existing: Record<string, unknown>
    try {
      existing = normalizeAntigravityMcpPayload(await readAntigravityMcp(args.globalPath) ?? {})
    } catch (error) {
      args.warnings.push(
        `Failed to read legacy Antigravity MCP at ${args.globalPath}; skipped legacy cleanup. ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    const existingServers = recordFrom(existing.mcpServers)
    const nextServers = mergeManagedServers(existingServers, args.previousManagedNames, {})
    const nextPayload = normalizeAntigravityMcpPayload({
      ...existing,
      mcpServers: nextServers
    })

    await writeManagedFile({
      absolutePath: args.globalPath,
      content: `${JSON.stringify(nextPayload, null, 2)}\n`,
      projectRoot: args.projectRoot,
      check: args.check,
      changed: args.changed
    })
  } finally {
    if (releaseLock) await releaseLock()
  }
}

/**
 * Synchronizes the Windsurf global MCP by merging generated managed servers into the existing global MCP and updating the managed-server state.
 *
 * Merges `rawGenerated` (when `enabled`) into the existing MCP's `mcpServers`, removes previously-managed entries, writes the resulting MCP to `globalPath`, and updates `statePath` with the current set of managed server names. Uses a filesystem lock to avoid concurrent writes and appends any warnings to `warnings` and file-change paths to `changed`.
 *
 * @param args.enabled - Whether generated MCP entries should be applied (if false, previously-managed names are only removed)
 * @param args.globalPath - Absolute path to the Windsurf global MCP file to read and/or write
 * @param args.statePath - Path to the JSON file that records currently managed server names; will be updated when not in `check` mode
 * @param args.rawGenerated - Raw JSON string produced for Windsurf; parsed when `enabled` and non-empty
 * @param args.projectRoot - Project root used when writing managed files
 * @param args.check - If true, perform a dry run (no state update) while still validating and computing the resulting content
 * @param args.changed - Array that will be appended with paths that were written or would be written
 * @param args.warnings - Array that will be appended with human-readable warnings encountered during processing
 */
async function syncManagedWindsurfGlobal(args: {
  enabled: boolean
  globalPath: string
  statePath: string
  rawGenerated: string
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const previousNames = await readManagedGlobalNames(args.statePath)
  if (!args.enabled && previousNames.length === 0) return

  const lockPath = path.join(path.dirname(args.globalPath), '.agents-windsurf-mcp.lock')
  const releaseLock = args.check ? null : await acquireSyncLock(lockPath)
  try {
    let existing: Record<string, unknown> = {}
    if (await pathExists(args.globalPath)) {
      try {
        existing = normalizeWindsurfMcpPayload(await readWindsurfMcp(args.globalPath) ?? {})
      } catch (error) {
        args.warnings.push(
          `Failed to read existing Windsurf MCP at ${args.globalPath}; skipped Windsurf global sync. ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
    }

    const generated = args.enabled && args.rawGenerated.trim().length > 0
      ? normalizeWindsurfMcpPayload(parseJsonObject(args.rawGenerated, 'generated Windsurf config'))
      : normalizeWindsurfMcpPayload({})
    const managedServers = recordFrom(generated.mcpServers)
    const existingServers = recordFrom(existing.mcpServers)
    const nextServers = mergeManagedServers(existingServers, previousNames, managedServers)
    const nextPayload = normalizeWindsurfMcpPayload({
      ...existing,
      mcpServers: nextServers
    })

    await writeManagedFile({
      absolutePath: args.globalPath,
      content: `${JSON.stringify(nextPayload, null, 2)}\n`,
      projectRoot: args.projectRoot,
      check: args.check,
      changed: args.changed
    })

    if (!args.check) {
      await writeManagedGlobalNames(args.statePath, args.enabled ? Object.keys(managedServers) : [])
    }
  } finally {
    if (releaseLock) await releaseLock()
  }
}

async function readManagedGlobalNames(statePath: string): Promise<string[]> {
  if (!(await pathExists(statePath))) return []
  try {
    const parsed = await readJson<ManagedGlobalState>(statePath)
    return Array.isArray(parsed.managedNames)
      ? parsed.managedNames.filter((name): name is string => typeof name === 'string')
      : []
  } catch {
    return []
  }
}

async function writeManagedGlobalNames(statePath: string, managedNames: string[]): Promise<void> {
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    managedNames: [...new Set(managedNames)].sort((a, b) => a.localeCompare(b))
  })
}

function mergeManagedServers(
  existingServers: Record<string, unknown>,
  previousManagedNames: string[],
  nextManagedServers: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...existingServers }
  for (const name of previousManagedNames) {
    delete next[name]
  }
  for (const [name, server] of Object.entries(nextManagedServers)) {
    next[name] = server
  }
  return next
}

function recordFrom(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
