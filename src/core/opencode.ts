import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { toLegacyOpencodeServer, type OpencodeServerEntry } from './renderers.js'
export {
  getOpencodeConfigPath,
  getOpencodeDir,
  getOpencodeGlobalConfigDir,
  getOpencodeGlobalConfigPath
} from './paths.js'

export const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json'

export interface OpencodeConfig {
  $schema?: string
  mcp?: Record<string, unknown>
  [key: string]: unknown
}

/** Read and parse an OpenCode configuration file as an OpencodeConfig object. */
export async function readOpencodeConfig(configPath: string): Promise<OpencodeConfig> {
  if (!(await pathExists(configPath))) {
    return {}
  }
  return readJson<OpencodeConfig>(configPath)
}

/** Atomically write an OpenCode configuration object to disk after normalization. */
export async function writeOpencodeConfig(configPath: string, config: OpencodeConfig): Promise<void> {
  await ensureDir(path.dirname(configPath))
  await writeJsonAtomic(configPath, normalizeOpencodeConfig(config))
}

/** Normalize an OpenCode configuration ensuring $schema and a valid mcp record. */
export function normalizeOpencodeConfig(config: OpencodeConfig): OpencodeConfig & {
  $schema: string
  mcp: Record<string, unknown>
} {
  const { $schema: existingSchema, mcp, ...rest } = config
  return {
    $schema: typeof existingSchema === 'string' && existingSchema !== ''
      ? existingSchema
      : OPENCODE_CONFIG_SCHEMA,
    ...rest,
    mcp: isRecord(mcp) ? mcp : {}
  }
}

/**
 * Where agents writes OpenCode servers: the legacy `mcp.<name>` map that every
 * OpenCode version reads, or the V2 `mcp.servers` map that OpenCode 1.x rejects.
 */
export type OpencodeLayout = 'legacy' | 'servers'

/** Managed server names, grouped by the map they live in. */
export type OpencodeEntryNames = Record<OpencodeLayout, string[]>

export interface OpencodeOwnership {
  layout: OpencodeLayout
  managedNames: string[]
}

/** Keys that OpenCode 2 reads as settings inside `mcp` rather than as legacy servers. */
const V2_MCP_KEYS = new Set(['servers', 'timeout'])

function isLegacyServer(value: unknown): boolean {
  return isRecord(value) && (value.type === 'local' || value.type === 'remote')
}

/** Whether `mcp` holds a V2 server map, as opposed to a legacy server named "servers". */
export function hasOpencodeServersMap(mcp: Record<string, unknown>): boolean {
  return isRecord(mcp.servers) && !isLegacyServer(mcp.servers)
}

/** Whether a name inside `mcp` is a legacy server entry, not a V2 setting. */
function isLegacyServerKey(mcp: Record<string, unknown>, name: string): boolean {
  return !V2_MCP_KEYS.has(name) || isLegacyServer(mcp[name])
}

/** Whether OpenCode 2 would read a legacy server with this name as a setting. */
export function isReservedOpencodeName(name: string): boolean {
  return V2_MCP_KEYS.has(name)
}

/** Names of every server configured in `mcp`, in either shape. */
export function listOpencodeServerNames(mcp: Record<string, unknown>): string[] {
  const legacy = Object.keys(mcp).filter((name) => isLegacyServerKey(mcp, name))
  const servers = hasOpencodeServersMap(mcp) ? Object.keys(mcp.servers as Record<string, unknown>) : []
  return [...new Set([...legacy, ...servers])]
}

/** Which of the given names already exist in each map of `mcp`. */
export function locateOpencodeEntries(mcp: Record<string, unknown>, names: string[]): OpencodeEntryNames {
  const servers = hasOpencodeServersMap(mcp) ? mcp.servers as Record<string, unknown> : {}
  return {
    legacy: names.filter((name) => name in mcp && isLegacyServerKey(mcp, name)),
    servers: names.filter((name) => name in servers)
  }
}

/**
 * Read which servers a previous sync wrote and where. A record from 0.9.3 and earlier
 * has no `layout`; those releases wrote only the legacy shape.
 *
 * @returns null when no record exists
 * @throws when the record cannot be read
 */
export async function readOpencodeOwnership(statePath: string): Promise<OpencodeOwnership | null> {
  if (!(await pathExists(statePath))) return null
  const state = await readJson<{ layout?: unknown; managedNames?: unknown }>(statePath)
  const names = state.managedNames
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    throw new Error(`Invalid OpenCode ownership record at ${statePath}`)
  }
  return { layout: state.layout === 'servers' ? 'servers' : 'legacy', managedNames: names }
}

export async function writeOpencodeOwnership(statePath: string, ownership: OpencodeOwnership): Promise<void> {
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    layout: ownership.layout,
    managedNames: [...ownership.managedNames].sort((a, b) => a.localeCompare(b))
  })
}

export function ownedOpencodeEntries(ownership: OpencodeOwnership): OpencodeEntryNames {
  return ownership.layout === 'servers'
    ? { legacy: [], servers: ownership.managedNames }
    : { legacy: ownership.managedNames, servers: [] }
}

/**
 * Find managed entries when no ownership record exists, by matching the config
 * against a previous preview. Only identical entries count, so a server the user
 * edited by hand stays theirs. The preview is V2 since 0.9.4 and legacy before.
 */
export function adoptOpencodeEntries(
  mcp: Record<string, unknown>,
  preview: Record<string, unknown>,
): OpencodeEntryNames {
  const adopted: OpencodeEntryNames = { legacy: [], servers: [] }
  const previewMcp = isRecord(preview.mcp) ? preview.mcp : {}

  if (!hasOpencodeServersMap(previewMcp)) {
    for (const [name, entry] of Object.entries(previewMcp)) {
      if (isLegacyServerKey(mcp, name) && isDeepStrictEqual(mcp[name], entry)) adopted.legacy.push(name)
    }
    return adopted
  }

  const servers = hasOpencodeServersMap(mcp) ? mcp.servers as Record<string, unknown> : {}
  for (const [name, entry] of Object.entries(previewMcp.servers as Record<string, OpencodeServerEntry>)) {
    if (isDeepStrictEqual(servers[name], entry)) {
      adopted.servers.push(name)
    } else if (isLegacyServerKey(mcp, name) && isDeepStrictEqual(mcp[name], toLegacyOpencodeServer(entry).entry)) {
      adopted.legacy.push(name)
    }
  }
  return adopted
}

/** Return a copy of `mcp` without the given entries. A V2 map emptied this way is removed. */
export function removeOpencodeEntries(
  mcp: Record<string, unknown>,
  names: OpencodeEntryNames,
): Record<string, unknown> {
  const next = { ...mcp }
  for (const name of names.legacy) {
    if (isLegacyServerKey(next, name)) delete next[name]
  }
  if (names.servers.length > 0 && hasOpencodeServersMap(next)) {
    const servers = { ...(next.servers as Record<string, unknown>) }
    for (const name of names.servers) delete servers[name]
    if (Object.keys(servers).length > 0) next.servers = servers
    else delete next.servers
  }
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
