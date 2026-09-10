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
const LEGACY_EXPAND_SETS: IntegrationName[][] = [
  ['codex', 'claude', 'gemini', 'copilot_vscode'],
  ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity']
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

export async function loadResolvedRegistry(
  projectRoot: string,
  options?: { profile?: string | null },
): Promise<ResolvedRegistry> {
  const config = await loadAgentsConfig(projectRoot)
  const local = await loadLocalOverrides(projectRoot)

  const profileName = options?.profile === undefined ? config.activeProfile : options.profile
  const profile = profileName ? config.profiles?.[profileName] : undefined
  const warnings: string[] = []
  if (profileName && !profile) {
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

  const serversByTarget = Object.fromEntries(
    ALL_INTEGRATIONS.map((id) => [id, [] as ResolvedMcpServer[]]),
  ) as Record<IntegrationName, ResolvedMcpServer[]>

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
    selectedServerNames.push(name)

    const targets = normalizeTargets(merged.targets)
    for (const target of targets) {
      if (!ALL_INTEGRATIONS.includes(target)) {
        warnings.push(`MCP server "${name}" has unsupported target "${target}"; ignored for that target.`)
        continue
      }
      serversByTarget[target].push(resolved)
    }
  }

  for (const target of ALL_INTEGRATIONS) {
    serversByTarget[target].sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    serversByTarget,
    warnings,
    missingRequiredEnv,
    selectedServerNames
  }
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

function sameSet(a: IntegrationName[], b: IntegrationName[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

function resolveServer(
  name: string,
  server: McpServerDefinition,
  projectRoot: string,
  warnings: string[],
): ResolvedMcpServer {
  const resolveValue = (value: string | undefined): string | undefined => {
    if (!value) return value
    // ${VAR} and ${VAR:-fallback}; the fallback form never warns because it always resolves.
    return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_full, key: string, fallback?: string) => {
      if (key === 'PROJECT_ROOT') return projectRoot
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
