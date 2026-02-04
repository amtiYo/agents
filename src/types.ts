export const SCHEMA_VERSION = 1

export type IntegrationName = 'codex' | 'claude' | 'gemini' | 'copilot_vscode'

export type LinkMode = 'symlink' | 'copy'

export interface AgentsConfig {
  schemaVersion: number
  projectRoot: string
  agentsMdPath: string
  enabledIntegrations: IntegrationName[]
  linkMode: LinkMode
  lastSync: string | null
}

export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpServer {
  transport: McpTransportType
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  cwd?: string
  requiredEnv?: string[]
  targets: IntegrationName[]
  enabled: boolean
}

export interface McpRegistry {
  mcpServers: Record<string, McpServer>
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
