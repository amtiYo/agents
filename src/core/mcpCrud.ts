import { loadAgentsConfig, saveAgentsConfig } from './config.js'
import { pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { AgentsConfig, LocalOverridesFile, McpServerDefinition } from '../types.js'

export interface McpState {
  config: AgentsConfig
  local: LocalOverridesFile
}

export interface McpServerEntry {
  name: string
  server: McpServerDefinition
  mergedServer: McpServerDefinition
  localOverride?: Partial<McpServerDefinition>
  hasLocalOverride: boolean
}

export interface McpServerUpsertInput {
  name: string
  server: McpServerDefinition
  localOverride?: Partial<McpServerDefinition>
}

export async function loadMcpState(projectRoot: string): Promise<McpState> {
  const config = await loadAgentsConfig(projectRoot)
  const paths = getProjectPaths(projectRoot)
  let local: LocalOverridesFile = { mcpServers: {} }

  if (await pathExists(paths.agentsLocal)) {
    local = await readJson<LocalOverridesFile>(paths.agentsLocal)
  }

  return {
    config,
    local: {
      mcpServers: typeof local.mcpServers === 'object' && local.mcpServers !== null ? local.mcpServers : {},
      meta: typeof local.meta === 'object' && local.meta !== null ? local.meta : undefined
    }
  }
}

export async function saveMcpState(projectRoot: string, state: McpState): Promise<void> {
  await saveAgentsConfig(projectRoot, state.config)
  const paths = getProjectPaths(projectRoot)
  await writeJsonAtomic(paths.agentsLocal, state.local)
}

export async function upsertMcpServers(args: {
  projectRoot: string
  updates: McpServerUpsertInput[]
  replace: boolean
}): Promise<{ created: string[]; updated: string[] }> {
  const state = await loadMcpState(args.projectRoot)
  const created: string[] = []
  const updated: string[] = []

  for (const update of args.updates) {
    const exists = Object.prototype.hasOwnProperty.call(state.config.mcp.servers, update.name)
    if (exists && !args.replace) {
      throw new Error(`MCP server "${update.name}" already exists. Use --replace to overwrite.`)
    }
  }

  for (const update of args.updates) {
    const exists = Object.prototype.hasOwnProperty.call(state.config.mcp.servers, update.name)
    state.config.mcp.servers[update.name] = update.server

    if (hasMeaningfulOverride(update.localOverride)) {
      state.local.mcpServers[update.name] = update.localOverride as Partial<McpServerDefinition>
    } else if (exists) {
      delete state.local.mcpServers[update.name]
    }

    if (exists) {
      updated.push(update.name)
    } else {
      created.push(update.name)
    }
  }

  await saveMcpState(args.projectRoot, state)

  return {
    created: created.sort((a, b) => a.localeCompare(b)),
    updated: updated.sort((a, b) => a.localeCompare(b))
  }
}

export async function removeMcpServer(args: {
  projectRoot: string
  name: string
  ignoreMissing: boolean
}): Promise<boolean> {
  const state = await loadMcpState(args.projectRoot)
  const exists = Object.prototype.hasOwnProperty.call(state.config.mcp.servers, args.name)
  if (!exists) {
    if (args.ignoreMissing) return false
    throw new Error(`MCP server "${args.name}" does not exist.`)
  }

  delete state.config.mcp.servers[args.name]
  delete state.local.mcpServers[args.name]
  await saveMcpState(args.projectRoot, state)
  return true
}

export function listMcpEntries(state: McpState): McpServerEntry[] {
  const names = Object.keys(state.config.mcp.servers).sort((a, b) => a.localeCompare(b))
  return names.map((name) => {
    const server = state.config.mcp.servers[name]
    const localOverride = state.local.mcpServers[name]
    return {
      name,
      server,
      mergedServer: mergeServerWithLocal(server, localOverride),
      localOverride,
      hasLocalOverride: hasMeaningfulOverride(localOverride)
    }
  })
}

export function mergeServerWithLocal(
  server: McpServerDefinition,
  localOverride: Partial<McpServerDefinition> | undefined,
): McpServerDefinition {
  return deepMerge(server, localOverride ?? {}) as McpServerDefinition
}

function hasMeaningfulOverride(value: Partial<McpServerDefinition> | undefined): boolean {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([, entry]) => entry !== undefined)
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
