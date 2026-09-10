import path from 'node:path'
import { copyFile, ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import { INTEGRATION_IDS } from '../integrations/registry.js'
import type {
  AgentsConfig,
  ClaudeScope,
  CopilotCliPath,
  IntegrationName,
  McpProfile,
  McpServerDefinition,
  SyncMode
} from '../types.js'
import { AGENTS_SCHEMA_VERSION } from '../types.js'

export const DEFAULT_VSCODE_HIDDEN_PATHS = [
  '**/.codex',
  '**/.claude',
  '**/.gemini',
  '**/.cursor',
  '**/.antigravity',
  '**/.agents/mcp_config.json',
  '**/.windsurf',
  '**/.opencode',
  '**/.junie',
  '**/.mcp.json',
  '**/opencode.json',
  '**/.agents/generated',
  '**/.grok',
  '**/.amp',
  '**/.factory',
  '**/.kilo',
  '**/kilo.jsonc',
  '**/.devin',
  '**/.zed'
]

const DEFAULT_TARGETS: IntegrationName[] = [...INTEGRATION_IDS]

const DEFAULT_MCP_SERVERS: Record<string, McpServerDefinition> = {
  filesystem: {
    label: 'Filesystem',
    description: 'Read and write files in the current project',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
    targets: DEFAULT_TARGETS,
    enabled: true
  },
  fetch: {
    label: 'Fetch',
    description: 'HTTP fetching and scraping helpers',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {
      FASTMCP_LOG_LEVEL: 'ERROR'
    },
    targets: DEFAULT_TARGETS,
    enabled: true
  },
  git: {
    label: 'Git',
    description: 'Repository-aware git operations',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '${PROJECT_ROOT}'],
    env: {
      FASTMCP_LOG_LEVEL: 'ERROR'
    },
    targets: DEFAULT_TARGETS,
    enabled: true
  }
}

export function createDefaultAgentsConfig(args?: {
  enabledIntegrations?: IntegrationName[]
  integrationOptions?: {
    cursorAutoApprove: boolean
    antigravityGlobalSync: boolean
    claudeScope?: ClaudeScope
    copilotCliPath?: CopilotCliPath
  }
  syncMode?: SyncMode
  hideGenerated?: boolean
  hiddenPaths?: string[]
  mcpServers?: Record<string, McpServerDefinition>
}): AgentsConfig {
  return {
    schemaVersion: AGENTS_SCHEMA_VERSION,
    instructions: {
      path: 'AGENTS.md'
    },
    integrations: {
      enabled: [...(args?.enabledIntegrations ?? [])],
      options: {
        cursorAutoApprove: args?.integrationOptions?.cursorAutoApprove !== false,
        antigravityGlobalSync: args?.integrationOptions?.antigravityGlobalSync !== false,
        claudeScope: normalizeClaudeScope(args?.integrationOptions?.claudeScope),
        copilotCliPath: normalizeCopilotCliPath(args?.integrationOptions?.copilotCliPath)
      }
    },
    syncMode: args?.syncMode ?? 'source-only',
    mcp: {
      servers: JSON.parse(
        JSON.stringify(args?.mcpServers ?? DEFAULT_MCP_SERVERS),
      ) as Record<string, McpServerDefinition>
    },
    workspace: {
      vscode: {
        hideGenerated: args?.hideGenerated !== false,
        hiddenPaths: [...(args?.hiddenPaths ?? DEFAULT_VSCODE_HIDDEN_PATHS)]
      }
    },
    lastSync: null,
    lastSyncSourceHash: null
  }
}

/** Lowest schema version this CLI can read and migrate forward. */
export const MIN_SUPPORTED_SCHEMA_VERSION = 3

function normalizeClaudeScope(value: unknown): ClaudeScope {
  return value === 'local' ? 'local' : 'project'
}

function normalizeCopilotCliPath(value: unknown): CopilotCliPath {
  return value === '.github/mcp.json' ? '.github/mcp.json' : '.mcp.json'
}

/**
 * Normalize the profile map without losing entries.
 *
 * A profile whose `servers` is not an array is kept as written rather than dropped:
 * the next `saveAgentsConfig` would otherwise delete a user's profile silently. It is
 * normalized to an empty server list so the rest of the code can rely on the shape.
 */
function normalizeProfiles(value: unknown): Record<string, McpProfile> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

  const out: Record<string, McpProfile> = {}
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      out[name] = { servers: [] }
      continue
    }
    const entry = raw as { description?: unknown; servers?: unknown }
    out[name] = {
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      servers: Array.isArray(entry.servers)
        ? entry.servers.filter((item): item is string => typeof item === 'string')
        : []
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Bring an on-disk config up to the current schema version.
 *
 * @returns The schema version the config was migrated from, or `null` when it was already current.
 */
export function migrateAgentsConfig(config: AgentsConfig): number | null {
  const found = typeof config.schemaVersion === 'number' ? config.schemaVersion : 0

  if (found === AGENTS_SCHEMA_VERSION) return null
  if (found < MIN_SUPPORTED_SCHEMA_VERSION || found > AGENTS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported agents schema version ${String(config.schemaVersion)}. Expected ${String(AGENTS_SCHEMA_VERSION)}.`,
    )
  }

  // 3 -> 4: Claude Code moved to project scope, Copilot CLI gained a second config path.
  // Existing projects keep the behavior they were set up with, so claudeScope stays `local`.
  if (found === 3) {
    config.integrations = {
      ...config.integrations,
      options: {
        ...config.integrations?.options,
        claudeScope: 'local',
        copilotCliPath: '.mcp.json'
      }
    }
  }

  config.schemaVersion = AGENTS_SCHEMA_VERSION
  return found
}

export interface LoadedAgentsConfig {
  config: AgentsConfig
  /** Schema version the file was migrated from, or `null` when it was already current. */
  migratedFrom: number | null
}

export async function loadAgentsConfig(projectRoot: string): Promise<AgentsConfig> {
  return (await loadAgentsConfigDetailed(projectRoot)).config
}

export async function loadAgentsConfigDetailed(projectRoot: string): Promise<LoadedAgentsConfig> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.agentsConfig))) {
    throw new Error(`Missing config: ${paths.agentsConfig}. Run "agents start" first.`)
  }

  const config = await readJson<AgentsConfig>(paths.agentsConfig)
  const migratedFrom = migrateAgentsConfig(config)

  config.instructions = {
    path: config.instructions?.path?.trim() || 'AGENTS.md'
  }

  config.integrations = {
    enabled: Array.isArray(config.integrations?.enabled)
      ? [...new Set(config.integrations.enabled)]
      : [],
    options: {
      cursorAutoApprove: config.integrations?.options?.cursorAutoApprove !== false,
      antigravityGlobalSync: config.integrations?.options?.antigravityGlobalSync !== false,
      claudeScope: normalizeClaudeScope(config.integrations?.options?.claudeScope),
      copilotCliPath: normalizeCopilotCliPath(config.integrations?.options?.copilotCliPath)
    }
  }

  const profiles = normalizeProfiles(config.profiles)
  if (profiles) {
    config.profiles = profiles
  } else {
    delete config.profiles
  }

  // An active profile that no longer exists is kept as written, so the sync can say
  // so instead of silently widening the run to every server.
  if (typeof config.activeProfile !== 'string' || config.activeProfile.trim().length === 0) {
    config.activeProfile = null
  }

  if (config.syncMode !== 'source-only' && config.syncMode !== 'commit-generated') {
    config.syncMode = 'source-only'
  }

  config.mcp = {
    servers: typeof config.mcp?.servers === 'object' && config.mcp?.servers !== null
      ? config.mcp.servers
      : {}
  }

  config.workspace = {
    vscode: {
      hideGenerated: config.workspace?.vscode?.hideGenerated !== false,
      hiddenPaths: Array.isArray(config.workspace?.vscode?.hiddenPaths) && config.workspace.vscode.hiddenPaths.length > 0
        ? [...new Set(config.workspace.vscode.hiddenPaths)]
        : [...DEFAULT_VSCODE_HIDDEN_PATHS]
    }
  }

  if (config.lastSync !== null && typeof config.lastSync !== 'string') {
    config.lastSync = null
  }

  if (typeof config.lastSyncSourceHash !== 'string') {
    config.lastSyncSourceHash = null
  }

  return { config, migratedFrom }
}

export async function saveAgentsConfig(projectRoot: string, config: AgentsConfig): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(path.dirname(paths.agentsConfig))
  await writeJsonAtomic(paths.agentsConfig, config)
}

/**
 * Write a migrated config back to disk, keeping a copy of the previous file next to it.
 *
 * @returns Path of the backup file that was written.
 */
export async function persistMigratedConfig(
  projectRoot: string,
  config: AgentsConfig,
  migratedFrom: number,
): Promise<string> {
  const paths = getProjectPaths(projectRoot)
  const backupPath = `${paths.agentsConfig}.v${String(migratedFrom)}.bak`
  if (await pathExists(paths.agentsConfig)) {
    await copyFile(paths.agentsConfig, backupPath)
  }
  await saveAgentsConfig(projectRoot, config)
  return backupPath
}
