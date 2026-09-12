import { toHomeRelativePath, type ProjectPathKey, type ProjectPaths } from '../core/paths.js'
import type { IntegrationName } from '../types.js'

/** How a tool's configuration file is written, which decides how it is validated. */
export type ManagedConfigFormat = 'json' | 'jsonc' | 'toml' | 'yaml'

/**
 * The file a tool reads its MCP servers from.
 *
 * Commands that walk every integration take the path, the label and the parser from
 * here instead of each keeping its own list. Integrations whose file depends on an
 * option (Claude Code and Copilot CLI share `.mcp.json`, Claude Desktop has a
 * platform path) carry no descriptor and are handled where that choice is made.
 */
export interface ManagedConfigDescriptor {
  pathKey: ProjectPathKey
  format: ManagedConfigFormat
  /** Label for a project file. Without one the label is built from the path. */
  label?: string
  /** The file lives outside the project, so it is shared with every other project. */
  global?: boolean
  /**
   * In global mode the file moves under the home directory and the static label stops
   * describing it. Only OpenCode does this: the others keep the same relative path.
   */
  homeLabel?: boolean
  /**
   * Set when the managed servers live under one key of a JSON or JSONC document, which
   * is enough for `agents reset` to remove them without a cleanup routine of its own.
   * Formats with a managed block (Codex, Grok) or their own document shape (Goose,
   * OpenCode, Gemini) are cleaned by the code that knows them.
   */
  managedEntries?: { key: string; generatedPathKey: ProjectPathKey; shortLabel: string }
}

export interface IntegrationDefinition {
  id: IntegrationName
  label: string
  requiredBinary?: string
  /** The configuration file this integration reads, when it is the same file every time. */
  config?: ManagedConfigDescriptor
  /**
   * The tool discovers `.agents/skills` on its own, so no bridge directory is created
   * for it. Antigravity is not one of these: it does not follow symlinks and does not
   * read nested skills, so it gets a flat copy at `.gemini/skills` instead.
   */
  nativeSkills?: boolean
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    requiredBinary: 'codex',
    config: { pathKey: 'codexConfig', format: 'toml', label: '.codex/config.toml' }
  },
  { id: 'claude', label: 'Claude Code', requiredBinary: 'claude' },
  { id: 'claude_desktop', label: 'Claude Desktop' },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    requiredBinary: 'gemini',
    config: { pathKey: 'geminiSettings', format: 'json', label: '.gemini/settings.json' }
  },
  {
    id: 'copilot_vscode',
    label: 'Copilot VS Code',
    requiredBinary: 'code',
    nativeSkills: true,
    config: { pathKey: 'vscodeMcp', format: 'json', label: '.vscode/mcp.json' }
  },
  { id: 'copilot_cli', label: 'Copilot CLI', requiredBinary: 'copilot', nativeSkills: true },
  {
    id: 'cursor',
    label: 'Cursor',
    requiredBinary: 'cursor-agent',
    config: { pathKey: 'cursorMcp', format: 'json', label: '.cursor/mcp.json' }
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    requiredBinary: 'agy',
    config: { pathKey: 'antigravityWorkspaceMcp', format: 'json', label: '.agents/mcp_config.json' }
  },
  { id: 'windsurf', label: 'Devin Desktop (Windsurf)' },
  {
    id: 'opencode',
    label: 'OpenCode',
    requiredBinary: 'opencode',
    config: { pathKey: 'opencodeConfig', format: 'json', label: 'opencode.json', homeLabel: true }
  },
  {
    id: 'junie',
    label: 'Junie',
    requiredBinary: 'junie',
    config: { pathKey: 'junieMcp', format: 'json', label: '.junie/mcp/mcp.json' }
  },
  {
    id: 'grok',
    label: 'Grok Build',
    requiredBinary: 'grok',
    nativeSkills: true,
    config: { pathKey: 'grokConfig', format: 'toml', global: true }
  },
  {
    id: 'amp',
    label: 'Amp',
    requiredBinary: 'amp',
    nativeSkills: true,
    config: {
      pathKey: 'ampSettings',
      format: 'json',
      global: true,
      managedEntries: { key: 'amp.mcpServers', generatedPathKey: 'generatedAmp', shortLabel: 'Amp' }
    }
  },
  {
    id: 'droid',
    label: 'Factory Droid',
    requiredBinary: 'droid',
    nativeSkills: true,
    config: {
      pathKey: 'droidMcp',
      format: 'json',
      global: true,
      managedEntries: { key: 'mcpServers', generatedPathKey: 'generatedDroid', shortLabel: 'Droid' }
    }
  },
  {
    id: 'kilo',
    label: 'Kilo',
    requiredBinary: 'kilo',
    config: {
      pathKey: 'kiloConfig',
      format: 'jsonc',
      global: true,
      managedEntries: { key: 'mcp', generatedPathKey: 'generatedKilo', shortLabel: 'Kilo' }
    }
  },
  {
    id: 'devin',
    label: 'Devin CLI',
    requiredBinary: 'devin',
    nativeSkills: true,
    config: {
      pathKey: 'devinMcp',
      format: 'json',
      global: true,
      managedEntries: { key: 'mcpServers', generatedPathKey: 'generatedDevin', shortLabel: 'Devin' }
    }
  },
  {
    id: 'zed',
    label: 'Zed',
    requiredBinary: 'zed',
    nativeSkills: true,
    config: {
      pathKey: 'zedSettings',
      format: 'jsonc',
      global: true,
      managedEntries: { key: 'context_servers', generatedPathKey: 'generatedZed', shortLabel: 'Zed' }
    }
  },
  {
    id: 'goose',
    label: 'Goose',
    requiredBinary: 'goose',
    nativeSkills: true,
    config: { pathKey: 'gooseConfig', format: 'yaml', global: true }
  }
]

export const INTEGRATION_IDS: IntegrationName[] = INTEGRATIONS.map((item) => item.id)

/**
 * Resolve where an integration's configuration is and how to call it in output.
 *
 * One place decides this, so `status`, `doctor` and the cleanup paths cannot drift
 * apart on which file belongs to which tool.
 */
export function resolveManagedConfig(
  paths: ProjectPaths,
  descriptor: ManagedConfigDescriptor,
): { filePath: string; label: string } {
  const filePath = paths[descriptor.pathKey]
  const useStaticLabel = descriptor.label !== undefined && !(descriptor.homeLabel === true && paths.isHome)
  return {
    filePath,
    label: useStaticLabel ? (descriptor.label as string) : toHomeRelativePath(filePath)
  }
}

/** Every enabled integration whose configuration is one known file. */
export function listManagedConfigs(
  paths: ProjectPaths,
  enabled: IntegrationName[],
): Array<{ id: IntegrationName; descriptor: ManagedConfigDescriptor; filePath: string; label: string }> {
  const enabledSet = new Set(enabled)
  return INTEGRATIONS.flatMap((integration) => {
    if (!integration.config || !enabledSet.has(integration.id)) return []
    return [{ id: integration.id, descriptor: integration.config, ...resolveManagedConfig(paths, integration.config) }]
  })
}


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
