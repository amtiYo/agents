import type {
  IntegrationName,
  LocalOverridesFile,
  McpServerDefinition,
  ResolvedMcpServer,
  ResolvedRegistry
} from '../types.js'
import { loadAgentsConfig } from './config.js'
import { pathExists, readJson } from './fs.js'
import { getProjectPaths } from './paths.js'

const ALL_INTEGRATIONS: IntegrationName[] = ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity']
const LEGACY_INTEGRATIONS: IntegrationName[] = ['codex', 'claude', 'gemini', 'copilot_vscode']

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

export async function loadResolvedRegistry(projectRoot: string): Promise<ResolvedRegistry> {
  const config = await loadAgentsConfig(projectRoot)
  const local = await loadLocalOverrides(projectRoot)

  return resolveFromConfigAndLocal({
    projectRoot,
    servers: config.mcp.servers,
    local
  })
}

export function resolveFromConfigAndLocal(input: {
  projectRoot: string
  servers: Record<string, McpServerDefinition>
  local: LocalOverridesFile
}): ResolvedRegistry {
  const { projectRoot, servers, local } = input

  const warnings: string[] = []
  const missingRequiredEnv: string[] = []

  const serversByTarget: Record<IntegrationName, ResolvedMcpServer[]> = {
    codex: [],
    claude: [],
    gemini: [],
    copilot_vscode: [],
    cursor: [],
    antigravity: []
  }

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
  const hasLegacySet = LEGACY_INTEGRATIONS.every((id) => unique.includes(id))
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

function resolveServer(
  name: string,
  server: McpServerDefinition,
  projectRoot: string,
  warnings: string[],
): ResolvedMcpServer {
  const resolveValue = (value: string | undefined): string | undefined => {
    if (!value) return value
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, key: string) => {
      if (key === 'PROJECT_ROOT') return projectRoot
      const envValue = process.env[key]
      if (envValue === undefined) {
        warnings.push(`Environment variable "${key}" is not set (server: ${name}).`)
        return `\${${key}}`
      }
      return envValue
    })
  }

  return {
    name,
    transport: server.transport,
    command: resolveValue(server.command),
    args: server.args?.map((item) => resolveValue(item) ?? item),
    url: resolveValue(server.url),
    headers: server.headers
      ? Object.fromEntries(Object.entries(server.headers).map(([k, v]) => [k, resolveValue(v) ?? v]))
      : undefined,
    env: server.env
      ? Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, resolveValue(v) ?? v]))
      : undefined,
    cwd: resolveValue(server.cwd)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(override)) return override
  if (isObject(base) && isObject(override)) {
    const out: Record<string, unknown> = { ...base }
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in out ? deepMerge(out[key], value) : value
    }
    return out
  }
  return override === undefined ? base : override
}
