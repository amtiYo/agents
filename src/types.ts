export const AGENTS_SCHEMA_VERSION = 3

export type IntegrationName = 'codex' | 'claude' | 'gemini' | 'copilot_vscode' | 'cursor' | 'antigravity'
export type SyncMode = 'source-only' | 'commit-generated'

export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface AgentsConfig {
  schemaVersion: number
  instructions: {
    path: string
  }
  integrations: {
    enabled: IntegrationName[]
    options: {
      cursorAutoApprove: boolean
      antigravityGlobalSync: boolean
    }
  }
  syncMode: SyncMode
  mcp: {
    servers: Record<string, McpServerDefinition>
  }
  workspace: {
    vscode: {
      hideGenerated: boolean
      hiddenPaths: string[]
    }
  }
  lastSync: string | null
}

export interface McpServerDefinition {
  label?: string
  description?: string
  transport: McpTransportType
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  cwd?: string
  requiredEnv?: string[]
  targets?: IntegrationName[]
  enabled?: boolean
}

export interface LocalOverridesFile {
  mcpServers: Record<string, Partial<McpServerDefinition>>
}

export interface VscodeSettingsState {
  managedPaths: string[]
}

export interface LegacyProjectConfig {
  schemaVersion: number
  projectRoot: string
  agentsMdPath: string
  enabledIntegrations: IntegrationName[]
  integrationOptions: {
    cursorAutoApprove: boolean
    antigravityGlobalSync: boolean
  }
  syncMode: SyncMode
  lastSync: string | null
}

export interface ResolvedMcpServer {
  name: string
  transport: McpTransportType
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  cwd?: string
}

export interface ResolvedRegistry {
  serversByTarget: Record<IntegrationName, ResolvedMcpServer[]>
  warnings: string[]
  missingRequiredEnv: string[]
  selectedServerNames: string[]
}

export interface SyncOptions {
  projectRoot: string
  check: boolean
  verbose: boolean
}

export interface SyncResult {
  changed: string[]
  warnings: string[]
}
