import { pathExists, readJson } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { IntegrationName, McpRegistry, McpServer, ResolvedMcpServer, ResolvedRegistry } from '../types.js'

const INTEGRATIONS: IntegrationName[] = ['codex', 'claude', 'gemini', 'copilot_vscode']

export async function loadResolvedRegistry(projectRoot: string): Promise<ResolvedRegistry> {
  const paths = getProjectPaths(projectRoot)
  const base = await readJson<McpRegistry>(paths.mcpRegistry)
  const local = (await pathExists(paths.mcpLocal)) ? await readJson<Partial<McpRegistry>>(paths.mcpLocal) : {}
  const merged = deepMerge(base, local) as McpRegistry

  const warnings: string[] = []
  const missingRequiredEnv: string[] = []

  const serversByTarget: Record<IntegrationName, ResolvedMcpServer[]> = {
    codex: [],
    claude: [],
    gemini: [],
    copilot_vscode: []
  }

  for (const [name, server] of Object.entries(merged.mcpServers ?? {})) {
    if (!server || server.enabled === false) continue

    const missing = (server.requiredEnv ?? []).filter((envName) => !process.env[envName])
    if (missing.length > 0) {
      missingRequiredEnv.push(`${name}: ${missing.join(', ')}`)
      continue
    }

    const resolved = resolveServer(name, server, projectRoot, warnings)

    const targets = Array.isArray(server.targets) ? server.targets : []
    if (targets.length === 0) {
      warnings.push(`Server "${name}" has no targets and was ignored.`)
      continue
    }

    for (const target of targets) {
      if (!INTEGRATIONS.includes(target)) {
        warnings.push(`Server "${name}" has unknown target "${target}" and it was ignored.`)
        continue
      }
      serversByTarget[target].push(resolved)
    }
  }

  for (const target of INTEGRATIONS) {
    serversByTarget[target].sort((a, b) => a.name.localeCompare(b.name))
  }

  return { serversByTarget, warnings, missingRequiredEnv }
}

function resolveServer(name: string, server: McpServer, projectRoot: string, warnings: string[]): ResolvedMcpServer {
  const resolve = (value: string | undefined): string | undefined => {
    if (!value) return value
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, key: string) => {
      if (key === 'PROJECT_ROOT') return projectRoot
      const env = process.env[key]
      if (env === undefined) {
        warnings.push(`Environment variable "${key}" is not set (server: ${name}).`)
        return `\${${key}}`
      }
      return env
    })
  }

  return {
    name,
    transport: server.transport,
    command: resolve(server.command),
    args: server.args?.map((item) => resolve(item) ?? item),
    url: resolve(server.url),
    headers: server.headers
      ? Object.fromEntries(
          Object.entries(server.headers).map(([k, v]) => [k, resolve(v) ?? v]),
        )
      : undefined,
    env: server.env
      ? Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, resolve(v) ?? v]))
      : undefined,
    cwd: resolve(server.cwd)
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
