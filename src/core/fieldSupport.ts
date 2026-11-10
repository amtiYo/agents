import type { IntegrationName, ResolvedMcpServer } from '../types.js'

/**
 * Which integrations understand each optional MCP server field.
 *
 * A field set for a target that does not read it is silently dropped by that
 * tool's renderer, so the sync says so instead of leaving the user guessing.
 */
const FIELD_SUPPORT: Record<string, IntegrationName[]> = {
  timeout: ['droid', 'kilo', 'opencode', 'goose', 'codex', 'grok'],
  connectTimeout: ['droid', 'codex', 'grok'],
  tools: ['copilot_cli'],
  disabledTools: ['droid'],
  oauth: ['claude', 'droid', 'kilo', 'opencode'],
  headersHelper: ['claude'],
  bearerTokenEnvVar: ['codex', 'grok'],
  envFile: ['cursor'],
  cwd: ['codex', 'grok', 'gemini', 'copilot_vscode', 'cursor', 'antigravity', 'windsurf', 'opencode', 'kilo', 'junie', 'claude', 'copilot_cli', 'devin']
}

/** Fields that only matter for remote servers, so stdio servers never trigger a warning. */
const REMOTE_ONLY_FIELDS = new Set(['oauth', 'headersHelper', 'bearerTokenEnvVar'])

function isSet(server: ResolvedMcpServer, field: string): boolean {
  const value = (server as unknown as Record<string, unknown>)[field]
  if (value === undefined || value === null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * Collect one warning per field that a server sets and a target integration ignores.
 *
 * @param serversByTarget - Resolved servers grouped by the integration they go to
 * @param enabled - Integrations that will actually be written this run
 */
export function collectUnsupportedFieldWarnings(
  serversByTarget: Record<IntegrationName, ResolvedMcpServer[]>,
  enabled: IntegrationName[],
): string[] {
  const perField = new Map<string, Set<IntegrationName>>()

  for (const integration of enabled) {
    for (const server of serversByTarget[integration] ?? []) {
      for (const [field, supportedBy] of Object.entries(FIELD_SUPPORT)) {
        if (!isSet(server, field)) continue
        if (supportedBy.includes(integration)) continue
        if (REMOTE_ONLY_FIELDS.has(field) && server.transport === 'stdio') continue

        const key = `${server.name}\u0000${field}`
        const targets = perField.get(key) ?? new Set<IntegrationName>()
        targets.add(integration)
        perField.set(key, targets)
      }
    }
  }

  return [...perField.entries()]
    .map(([key, targets]) => {
      const [name, field] = key.split('\u0000')
      const list = [...targets].sort((a, b) => a.localeCompare(b)).join(', ')
      return `MCP server "${String(name)}": "${String(field)}" is not supported by ${list} and was left out of those configs.`
    })
    .sort((a, b) => a.localeCompare(b))
}
