export const PROJECT_SCHEMA_VERSION = 2
export const MCP_SELECTION_SCHEMA_VERSION = 1
export const CATALOG_SCHEMA_VERSION = 1

export type IntegrationName = 'codex' | 'claude' | 'gemini' | 'copilot_vscode' | 'cursor' | 'antigravity'
export type LinkMode = 'symlink' | 'copy'
export type SyncMode = 'source-only' | 'commit-generated'

export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface ProjectConfig {
  schemaVersion: number
  projectRoot: string
  agentsMdPath: string
  enabledIntegrations: IntegrationName[]
  integrationOptions: {
    cursorAutoApprove: boolean
    antigravityGlobalSync: boolean
  }
  linkMode: LinkMode
  syncMode: SyncMode
  selectedSkillPacks: string[]
  selectedSkills: string[]
  lastSync: string | null
}

export interface McpSelection {
  schemaVersion: number
  preset: string
  selectedMcpServers: string[]
}

export interface CatalogMcpServer {
  label: string
  description: string
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

export interface CatalogMcpPreset {
  id: string
  label: string
  description: string
  serverIds: string[]
}

export interface CatalogSkill {
  name: string
  description: string
  instructions: string
}

export interface CatalogSkillPack {
  id: string
  label: string
  description: string
  skillIds: string[]
}

export interface CatalogFile {
  schemaVersion: number
  mcpPresets: CatalogMcpPreset[]
  mcpServers: Record<string, CatalogMcpServer>
  skillPacks: CatalogSkillPack[]
  skills: Record<string, CatalogSkill>
}

export interface McpLocalFile {
  mcpServers: Record<string, Partial<CatalogMcpServer>>
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
