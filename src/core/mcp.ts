import type {
  IntegrationName,
  LocalOverridesFile,
  McpProfile,
  McpServerDefinition,
  ResolvedMcpServer,
  ResolvedRegistry
} from '../types.js'
import { loadAgentsConfig } from './config.js'
import { pathExists, readJson } from './fs.js'
import { deepMerge } from './objectUtils.js'
import { getProjectPaths } from './paths.js'
import { INTEGRATION_IDS } from '../integrations/registry.js'

const ALL_INTEGRATIONS: IntegrationName[] = INTEGRATION_IDS
/**
 * Target lists that were "every integration" in an earlier release. A server carrying
 * one of them is treated as universal again, so integrations added later still get it.
 */
const LEGACY_EXPAND_SETS: IntegrationName[][] = [
  ['codex', 'claude', 'gemini', 'copilot_vscode'],
  ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
  [
    'codex',
    'claude',
    'claude_desktop',
    'gemini',
    'copilot_vscode',
    'copilot_cli',
    'cursor',
    'antigravity',
    'windsurf',
    'opencode',
    'junie'
  ]
]

export async function loadLocalOverrides(projectRoot: string): Promise<LocalOverridesFile> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.agentsLocal))) {
    return { mcpServers: {} }
  }
  const parsed = await readJson<LocalOverridesFile>(paths.agentsLocal)
  return {
    mcpServers: typeof parsed.mcpServers === 'object' && parsed.mcpServers !== null ? parsed.mcpServers : {},
    meta: typeof parsed.meta === 'object' && parsed.meta !== null ? parsed.meta : undefined
  }
}

/**
 * Load the project config and resolve it into the servers each integration receives.
 *
 * @param options.profile - Profile for this run; omit to use the config's active
 * profile, pass `null` for every server. An explicitly named profile that does not
 * exist is an error rather than a silent widening.
 */
export async function loadResolvedRegistry(
  projectRoot: string,
  options?: { profile?: string | null },
): Promise<ResolvedRegistry> {
  const config = await loadAgentsConfig(projectRoot)
  const local = await loadLocalOverrides(projectRoot)

  const explicit = options?.profile !== undefined
  const profileName = explicit ? options.profile : config.activeProfile
  const profile = profileName ? config.profiles?.[profileName] : undefined
  const warnings: string[] = []
  if (profileName && !profile) {
    const known = Object.keys(config.profiles ?? {}).sort((a, b) => a.localeCompare(b))
    if (explicit) {
      // Asking for a narrower set and silently getting every server is the opposite
      // of what was requested, so a bad --profile is an error.
      throw new Error(
        `Profile "${profileName}" is not defined in .agents/agents.json. Known profiles: ${known.join(', ') || '(none)'}`,
      )
    }
    warnings.push(`Profile "${profileName}" is not defined in .agents/agents.json; using every server.`)
  }

  const resolved = resolveFromConfigAndLocal({
    projectRoot,
    servers: config.mcp.servers,
    local,
    profile
  })

  return { ...resolved, warnings: [...warnings, ...resolved.warnings] }
}

/**
 * Merge shared config with local overrides and group the result by integration.
 *
 * Servers are skipped when disabled, outside the profile, or missing required env;
 * each skip that the user would otherwise not notice produces a warning.
 */
export function resolveFromConfigAndLocal(input: {
  projectRoot: string
  servers: Record<string, McpServerDefinition>
  local: LocalOverridesFile
  profile?: McpProfile
}): ResolvedRegistry {
  const { projectRoot, servers, local, profile } = input
  const profileServers = profile ? new Set(profile.servers) : null

  const warnings: string[] = []
  const missingRequiredEnv: string[] = []

  // A profile that names a server which was since renamed or removed would otherwise
  // narrow the run, possibly to nothing, without a word.
  if (profileServers) {
    for (const wanted of [...profileServers].sort((a, b) => a.localeCompare(b))) {
      if (!servers[wanted]) {
        warnings.push(`Profile references MCP server "${wanted}", which is not configured; ignored.`)
      }
    }
  }

  const serversByTarget = Object.fromEntries(
    ALL_INTEGRATIONS.map((id) => [id, [] as ResolvedMcpServer[]]),
  ) as Record<IntegrationName, ResolvedMcpServer[]>
  const publicServersByTarget = Object.fromEntries(
    ALL_INTEGRATIONS.map((id) => [id, [] as ResolvedMcpServer[]]),
  ) as Record<IntegrationName, ResolvedMcpServer[]>
  const localOnlyKeysByServer: Record<string, string[]> = {}

  const selectedServerNames: string[] = []
  const localOverrides = local?.mcpServers ?? {}

  for (const name of Object.keys(servers).sort((a, b) => a.localeCompare(b))) {
    const base = servers[name]
    const override = localOverrides[name]
    const merged = deepMerge(base ?? {}, override ?? {}) as McpServerDefinition

    if (!merged.transport) {
      warnings.push(`MCP server "${name}" is invalid: missing transport.`)
      continue
    }

    if (merged.enabled === false) continue
    if (profileServers && !profileServers.has(name)) continue

    const missing = (merged.requiredEnv ?? []).filter((envName) => !process.env[envName])
    if (missing.length > 0) {
      missingRequiredEnv.push(`${name}: ${missing.join(', ')}`)
      continue
    }

    const resolved = resolveServer(name, merged, projectRoot, warnings)
    // The committed definition on its own, for configs that are not gitignored. The
    // warnings it would repeat are dropped: the same server already produced them above.
    const publicResolved = base
      ? resolveServer(name, base, projectRoot, [], 'committed')
      : resolved
    const localOnlyKeys = collectLocalOnlyKeys(base, override)
    if (localOnlyKeys.length > 0) {
      localOnlyKeysByServer[name] = localOnlyKeys
    }
    selectedServerNames.push(name)

    const targets = normalizeTargets(merged.targets)
    for (const target of targets) {
      if (!ALL_INTEGRATIONS.includes(target)) {
        warnings.push(`MCP server "${name}" has unsupported target "${target}"; ignored for that target.`)
        continue
      }
      serversByTarget[target].push(resolved)
      publicServersByTarget[target].push(publicResolved)
    }
  }

  for (const target of ALL_INTEGRATIONS) {
    serversByTarget[target].sort((a, b) => a.name.localeCompare(b.name))
    publicServersByTarget[target].sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    serversByTarget,
    publicServersByTarget,
    localOnlyKeysByServer,
    warnings,
    missingRequiredEnv,
    selectedServerNames
  }
}

/**
 * Value keys a server gets only from `.agents/local.json`.
 *
 * These are the values that must not reach a config kept in version control, so the
 * sync can name them when it writes the committed definition instead.
 */
function collectLocalOnlyKeys(
  base: McpServerDefinition | undefined,
  override: Partial<McpServerDefinition> | undefined,
): string[] {
  if (!override) return []

  const keys: string[] = []
  for (const field of ['env', 'headers'] as const) {
    const overrideRecord = override[field]
    if (!overrideRecord) continue
    const baseRecord = base?.[field] ?? {}
    for (const key of Object.keys(overrideRecord)) {
      if (overrideRecord[key] !== baseRecord[key]) {
        keys.push(`${field}.${key}`)
      }
    }
  }

  for (const field of ['command', 'url', 'cwd', 'headersHelper'] as const) {
    if (override[field] !== undefined && override[field] !== base?.[field]) {
      keys.push(field)
    }
  }

  if (override.args && JSON.stringify(override.args) !== JSON.stringify(base?.args)) {
    keys.push('args')
  }

  return keys.sort((a, b) => a.localeCompare(b))
}

function normalizeTargets(targets: IntegrationName[] | undefined): IntegrationName[] {
  if (!targets || targets.length === 0) {
    return ALL_INTEGRATIONS
  }

  const unique = [...new Set(targets)]
  const hasLegacySet = LEGACY_EXPAND_SETS.some((set) => sameSet(set, unique))
  if (!hasLegacySet) {
    return unique
  }

  const out = [...unique]
  for (const id of ALL_INTEGRATIONS) {
    if (!out.includes(id)) {
      out.push(id)
    }
  }
  return out
}

/** Whether two integration lists hold exactly the same ids, regardless of order. */
function sameSet(a: IntegrationName[], b: IntegrationName[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

/**
 * How far placeholders are expanded.
 *
 * `full` produces what a tool needs to start the server. `committed` produces what may be
 * written into a file that ends up in version control: `${PROJECT_ROOT}` and an explicit
 * `${VAR:-default}` resolve, a bare `${VAR}` stays as it is.
 */
type ResolutionMode = 'full' | 'committed'

/**
 * Expand placeholders in one server definition and copy through the optional fields.
 *
 * `${PROJECT_ROOT}`, `${VAR}` and `${VAR:-default}` are resolved here; a plain `${VAR}`
 * with nothing to resolve to is left in place and reported.
 */
function resolveServer(
  name: string,
  server: McpServerDefinition,
  projectRoot: string,
  warnings: string[],
  mode: ResolutionMode = 'full',
): ResolvedMcpServer {
  const resolveValue = (value: string | undefined): string | undefined => {
    if (!value) return value
    // ${VAR} and ${VAR:-fallback}; the fallback form never warns because it always resolves.
    return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_full, key: string, fallback?: string) => {
      if (key === 'PROJECT_ROOT') return projectRoot
      // A committed config must not carry a value read from the environment: the variable
      // is where the secret lives, and this CLI tells people to export exactly those. The
      // fallback form is safe, its value is already in the committed file.
      if (mode === 'committed') return fallback ?? `\${${key}}`
      const envValue = process.env[key]
      if (envValue !== undefined) return envValue
      if (fallback !== undefined) return fallback
      warnings.push(`Environment variable "${key}" is not set (server: ${name}).`)
      return `\${${key}}`
    })
  }

  const resolveRecord = (record: Record<string, string> | undefined): Record<string, string> | undefined =>
    record ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k, resolveValue(v) ?? v])) : undefined

  return {
    name,
    transport: server.transport,
    command: resolveValue(server.command),
    args: server.args?.map((item) => resolveValue(item) ?? item),
    url: resolveValue(server.url),
    headers: resolveRecord(server.headers),
    env: resolveRecord(server.env),
    cwd: resolveValue(server.cwd),
    ...(typeof server.timeout === 'number' ? { timeout: server.timeout } : {}),
    ...(typeof server.connectTimeout === 'number' ? { connectTimeout: server.connectTimeout } : {}),
    ...(server.tools ? { tools: [...server.tools] } : {}),
    ...(server.disabledTools ? { disabledTools: [...server.disabledTools] } : {}),
    ...(server.oauth
      ? {
          oauth: {
            ...server.oauth,
            ...(server.oauth.clientId ? { clientId: resolveValue(server.oauth.clientId) } : {}),
            ...(server.oauth.clientSecret ? { clientSecret: resolveValue(server.oauth.clientSecret) } : {})
          }
        }
      : {}),
    ...(server.headersHelper ? { headersHelper: resolveValue(server.headersHelper) } : {}),
    ...(server.bearerTokenEnvVar ? { bearerTokenEnvVar: server.bearerTokenEnvVar } : {}),
    ...(server.envFile ? { envFile: resolveValue(server.envFile) } : {})
  }
}
