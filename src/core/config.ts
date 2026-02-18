import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { AgentsConfig, IntegrationName, McpServerDefinition, SyncMode } from '../types.js'
import { AGENTS_SCHEMA_VERSION } from '../types.js'

export const DEFAULT_VSCODE_HIDDEN_PATHS = [
  '**/.codex',
  '**/.claude',
  '**/.gemini',
  '**/.cursor',
  '**/.antigravity',
  '**/.windsurf',
  '**/.opencode',
  '**/opencode.json',
  '**/.agents/generated'
]

const DEFAULT_MCP_SERVERS: Record<string, McpServerDefinition> = {
  filesystem: {
    label: 'Filesystem',
    description: 'Read and write files in the current project',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
    targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity', 'windsurf', 'opencode'],
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
    targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity', 'windsurf', 'opencode'],
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
    targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity', 'windsurf', 'opencode'],
    enabled: true
  }
}

export function createDefaultAgentsConfig(args?: {
  enabledIntegrations?: IntegrationName[]
  integrationOptions?: {
    cursorAutoApprove: boolean
    antigravityGlobalSync: boolean
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
        antigravityGlobalSync: args?.integrationOptions?.antigravityGlobalSync !== false
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
    lastSync: null
  }
}

export async function loadAgentsConfig(projectRoot: string): Promise<AgentsConfig> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.agentsConfig))) {
    throw new Error(`Missing config: ${paths.agentsConfig}. Run "agents start" first.`)
  }

  const config = await readJson<AgentsConfig>(paths.agentsConfig)
  if (config.schemaVersion !== AGENTS_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported agents schema version ${String(config.schemaVersion)}. Expected ${String(AGENTS_SCHEMA_VERSION)}.`,
    )
  }

  config.instructions = {
    path: config.instructions?.path?.trim() || 'AGENTS.md'
  }

  config.integrations = {
    enabled: Array.isArray(config.integrations?.enabled)
      ? [...new Set(config.integrations.enabled)]
      : [],
    options: {
      cursorAutoApprove: config.integrations?.options?.cursorAutoApprove !== false,
      antigravityGlobalSync: config.integrations?.options?.antigravityGlobalSync !== false
    }
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

  return config
}

export async function saveAgentsConfig(projectRoot: string, config: AgentsConfig): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(path.dirname(paths.agentsConfig))
  await writeJsonAtomic(paths.agentsConfig, config)
}

// Compatibility aliases for existing command imports.
export const loadProjectConfig = loadAgentsConfig
export const saveProjectConfig = saveAgentsConfig
