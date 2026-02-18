import type { IntegrationName } from '../types.js'

export interface IntegrationDefinition {
  id: IntegrationName
  label: string
  requiredBinary?: string
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  { id: 'codex', label: 'Codex', requiredBinary: 'codex' },
  { id: 'claude', label: 'Claude Code', requiredBinary: 'claude' },
  { id: 'gemini', label: 'Gemini CLI', requiredBinary: 'gemini' },
  { id: 'copilot_vscode', label: 'Copilot VS Code', requiredBinary: 'code' },
  { id: 'cursor', label: 'Cursor', requiredBinary: 'cursor-agent' },
  { id: 'antigravity', label: 'Antigravity', requiredBinary: 'antigravity' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'opencode', label: 'OpenCode' }
]

export const INTEGRATION_IDS: IntegrationName[] = INTEGRATIONS.map((item) => item.id)

export function parseIntegrationList(input: string): IntegrationName[] {
  const parsed = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const invalid = parsed.filter((item) => !INTEGRATION_IDS.includes(item as IntegrationName))
  if (invalid.length > 0) {
    throw new Error(`Unknown integrations: ${invalid.join(', ')}. Allowed: ${INTEGRATION_IDS.join(', ')}`)
  }

  return [...new Set(parsed as IntegrationName[])]
}
