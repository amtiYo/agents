import type { IntegrationName } from '../types.js'

export interface IntegrationDefinition {
  id: IntegrationName
  label: string
  requiredBinary?: string
  /**
   * The tool discovers `.agents/skills` on its own, so no bridge directory is created for it.
   */
  nativeSkills?: boolean
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  { id: 'codex', label: 'Codex', requiredBinary: 'codex' },
  { id: 'claude', label: 'Claude Code', requiredBinary: 'claude' },
  { id: 'claude_desktop', label: 'Claude Desktop' },
  { id: 'gemini', label: 'Gemini CLI', requiredBinary: 'gemini' },
  { id: 'copilot_vscode', label: 'Copilot VS Code', requiredBinary: 'code', nativeSkills: true },
  { id: 'copilot_cli', label: 'Copilot CLI', requiredBinary: 'copilot', nativeSkills: true },
  { id: 'cursor', label: 'Cursor', requiredBinary: 'cursor-agent' },
  { id: 'antigravity', label: 'Antigravity', requiredBinary: 'agy', nativeSkills: true },
  { id: 'windsurf', label: 'Devin Desktop (Windsurf)' },
  { id: 'opencode', label: 'OpenCode', requiredBinary: 'opencode' },
  { id: 'junie', label: 'Junie', requiredBinary: 'junie' },
  { id: 'grok', label: 'Grok Build', requiredBinary: 'grok' },
  { id: 'amp', label: 'Amp', requiredBinary: 'amp', nativeSkills: true },
  { id: 'droid', label: 'Factory Droid', requiredBinary: 'droid' },
  { id: 'kilo', label: 'Kilo', requiredBinary: 'kilo' },
  { id: 'devin', label: 'Devin CLI', requiredBinary: 'devin' },
  { id: 'zed', label: 'Zed', requiredBinary: 'zed' },
  { id: 'goose', label: 'Goose', requiredBinary: 'goose' }
]

export const INTEGRATION_IDS: IntegrationName[] = INTEGRATIONS.map((item) => item.id)

/**
 * Alternate names accepted on the CLI, mapped to the canonical integration id.
 * `windsurf` kept its id when the product was renamed to Devin Desktop, so both spellings work.
 */
export const INTEGRATION_ALIASES: Record<string, IntegrationName> = {
  devin_desktop: 'windsurf',
  'devin-desktop': 'windsurf',
  factory: 'droid',
  grok_build: 'grok',
  kilocode: 'kilo'
}

/** Resolve a user-supplied integration name, accepting aliases. */
export function resolveIntegrationName(input: string): IntegrationName | undefined {
  const normalized = input.trim().toLowerCase()
  if (INTEGRATION_IDS.includes(normalized as IntegrationName)) {
    return normalized as IntegrationName
  }
  return INTEGRATION_ALIASES[normalized]
}

/** Look up an integration definition by its canonical id. */
export function getIntegration(id: IntegrationName): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((item) => item.id === id)
}

/** Whether the tool finds `.agents/skills` itself, so no bridge directory is needed. */
export function hasNativeSkillsDiscovery(id: IntegrationName): boolean {
  return getIntegration(id)?.nativeSkills === true
}

/**
 * Parse a comma-separated `--llm` value into canonical integration ids.
 *
 * @throws When a name is neither an id nor a known alias.
 */
export function parseIntegrationList(input: string): IntegrationName[] {
  const parsed = input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const resolved: IntegrationName[] = []
  const invalid: string[] = []
  for (const item of parsed) {
    const match = resolveIntegrationName(item)
    if (match) {
      resolved.push(match)
    } else {
      invalid.push(item)
    }
  }

  if (invalid.length > 0) {
    throw new Error(`Unknown integrations: ${invalid.join(', ')}. Allowed: ${INTEGRATION_IDS.join(', ')}`)
  }

  return [...new Set(resolved)]
}
