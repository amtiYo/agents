export const AGENTS_SCHEMA_VERSION = 4

export type IntegrationName =
  | 'codex'
  | 'claude'
  | 'claude_desktop'
  | 'gemini'
  | 'copilot_vscode'
  | 'copilot_cli'
  | 'cursor'
  | 'antigravity'
  | 'windsurf'
  | 'opencode'
  | 'junie'
  | 'grok'
  | 'amp'
  | 'droid'
  | 'kilo'
  | 'devin'
  | 'zed'
  | 'goose'
export type SyncMode = 'source-only' | 'commit-generated'

export type McpTransportType = 'stdio' | 'http' | 'sse'

/** Where the Claude Code integration materializes MCP servers. */
export type ClaudeScope = 'project' | 'local'

/** Which file the Copilot CLI integration writes; both are read by Copilot CLI. */
export type CopilotCliPath = '.mcp.json' | '.github/mcp.json'

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
      claudeScope: ClaudeScope
      copilotCliPath: CopilotCliPath
    }
  }
  syncMode: SyncMode
  mcp: {
    servers: Record<string, McpServerDefinition>
  }
  profiles?: Record<string, McpProfile>
  activeProfile?: string | null
  workspace: {
    vscode: {
      hideGenerated: boolean
      hiddenPaths: string[]
    }
  }
  lastSync: string | null
  lastSyncSourceHash?: string | null
}

/** A named subset of MCP servers, applied on top of the shared registry. */
export interface McpProfile {
  description?: string
  servers: string[]
}

/** OAuth hints passed through to clients that support them (Claude Code, Droid, Kilo). */
export interface McpOAuthConfig {
  scopes?: string
  clientId?: string
  clientSecret?: string
  authServerMetadataUrl?: string
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
  /** Tool invocation timeout in milliseconds (Droid, Kilo, OpenCode, Goose). */
  timeout?: number
  /** Initial handshake timeout in milliseconds (Droid). */
  connectTimeout?: number
  /** Tool allowlist; `['*']` means every tool (Copilot CLI). */
  tools?: string[]
  /** Tools excluded from the server (Droid). */
  disabledTools?: string[]
  /** OAuth overrides for remote servers (Claude Code, Droid, Kilo). */
  oauth?: McpOAuthConfig
  /** Executable that prints auth headers at connect time (Claude Code). */
  headersHelper?: string
  /** Environment variable holding a bearer token (Codex, Grok). */
  bearerTokenEnvVar?: string
  /** Dotenv file loaded before launching the server (Cursor). */
  envFile?: string
}

export interface UpdateCheckMetadata {
  lastCheckedAt?: string
  lastSeenVersion?: string
  lastNotifiedAt?: string
  latestVersion?: string
}

export interface LocalOverridesFile {
  mcpServers: Record<string, Partial<McpServerDefinition>>
  meta?: {
    updateCheck?: UpdateCheckMetadata
  }
}

export interface VscodeSettingsState {
  managedPaths: string[]
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
  timeout?: number
  connectTimeout?: number
  tools?: string[]
  disabledTools?: string[]
  oauth?: McpOAuthConfig
  headersHelper?: string
  bearerTokenEnvVar?: string
  envFile?: string
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
  /** Profile applied for this run; falls back to the config's active profile. */
  profile?: string | null
}

export interface SyncResult {
  changed: string[]
  warnings: string[]
}
