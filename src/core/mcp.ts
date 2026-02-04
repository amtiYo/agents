import type {
  CatalogFile,
  CatalogMcpServer,
  IntegrationName,
  McpLocalFile,
  McpSelection,
  ResolvedMcpServer,
  ResolvedRegistry
} from '../types.js'
import { MCP_SELECTION_SCHEMA_VERSION } from '../types.js'
import { ensureGlobalCatalog } from './catalog.js'
import { pathExists, readJson } from './fs.js'
import { getProjectPaths } from './paths.js'

const ALL_INTEGRATIONS: IntegrationName[] = ['codex', 'claude', 'gemini', 'copilot_vscode']

export async function loadSelection(projectRoot: string): Promise<McpSelection> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.mcpSelection))) {
    throw new Error(`Missing MCP selection file: ${paths.mcpSelection}. Run "agents start".`)
  }

  const selection = await readJson<McpSelection>(paths.mcpSelection)
  if (selection.schemaVersion !== MCP_SELECTION_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported MCP selection schema ${String(selection.schemaVersion)}. Expected ${String(MCP_SELECTION_SCHEMA_VERSION)}.`,
    )
  }
  return selection
}

export async function loadResolvedRegistry(projectRoot: string): Promise<ResolvedRegistry> {
  const paths = getProjectPaths(projectRoot)
  const { catalog } = await ensureGlobalCatalog()
  const selection = await loadSelection(projectRoot)

  const local = (await pathExists(paths.mcpLocal))
    ? await readJson<McpLocalFile>(paths.mcpLocal)
    : { mcpServers: {} }

  return resolveFromCatalogAndSelection({
    projectRoot,
    catalog,
    selection,
    local
  })
}

export function resolveFromCatalogAndSelection(input: {
  projectRoot: string
  catalog: CatalogFile
  selection: McpSelection
  local: McpLocalFile
}): ResolvedRegistry {
  const { projectRoot, catalog, selection, local } = input

  const warnings: string[] = []
  const missingRequiredEnv: string[] = []

  const serversByTarget: Record<IntegrationName, ResolvedMcpServer[]> = {
    codex: [],
    claude: [],
    gemini: [],
    copilot_vscode: []
  }

  const selectedServerNames: string[] = []

  for (const name of selection.selectedMcpServers) {
    const base = catalog.mcpServers[name]
    const override = local.mcpServers[name]

    if (!base && !override) {
      warnings.push(`Selected MCP server "${name}" not found in catalog or local overrides.`)
      continue
    }

    const merged = deepMerge(base ?? {}, override ?? {}) as CatalogMcpServer

    if (!merged.transport) {
      warnings.push(`MCP server "${name}" is invalid: missing transport.`)
      continue
    }

    if (merged.enabled === false) {
      continue
    }

    const missing = (merged.requiredEnv ?? []).filter((envName) => !process.env[envName])
    if (missing.length > 0) {
      missingRequiredEnv.push(`${name}: ${missing.join(', ')}`)
      continue
    }

    const resolved = resolveServer(name, merged, projectRoot, warnings)
    selectedServerNames.push(name)

    const targets = merged.targets && merged.targets.length > 0 ? merged.targets : ALL_INTEGRATIONS
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

function resolveServer(
  name: string,
  server: CatalogMcpServer,
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
