import os from 'node:os'
import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'

export interface AntigravityMcpPayload {
  mcpServers?: Record<string, unknown>
  servers?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Resolve the absolute filesystem path for the legacy global Antigravity MCP configuration file.
 *
 * Uses the `AGENTS_ANTIGRAVITY_MCP_PATH` environment variable when set and non-empty; otherwise
 * returns an OS-specific default location (macOS, Windows with `APPDATA` fallback, or XDG/`~/.config` for other platforms).
 *
 * @returns Absolute path to the legacy global Antigravity MCP JSON file (`mcp.json`).
 */
export function getLegacyAntigravityGlobalMcpPath(): string {
  const override = process.env.AGENTS_ANTIGRAVITY_MCP_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'mcp.json')
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Antigravity', 'User', 'mcp.json')
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim().length > 0
    ? process.env.XDG_CONFIG_HOME
    : path.join(os.homedir(), '.config')
  return path.join(xdgConfigHome, 'Antigravity', 'User', 'mcp.json')
}

export async function readAntigravityMcp(pathToRead: string): Promise<AntigravityMcpPayload | undefined> {
  if (!(await pathExists(pathToRead))) return undefined
  return readJson<AntigravityMcpPayload>(pathToRead)
}

export async function writeAntigravityMcp(pathToWrite: string, payload: AntigravityMcpPayload): Promise<void> {
  await ensureDir(path.dirname(pathToWrite))
  await writeJsonAtomic(pathToWrite, normalizeAntigravityMcpPayload(payload))
}

/**
 * Normalize an Antigravity MCP payload to the current shape by ensuring server mappings are exposed under `mcpServers` and removing legacy `servers` and `inputs` properties.
 *
 * @param payload - The MCP payload that may use current (`mcpServers`) or legacy (`servers`) server keys
 * @returns A payload object with `mcpServers` containing the chosen server mapping and without legacy `servers` or `inputs` properties
 */
export function normalizeAntigravityMcpPayload(payload: AntigravityMcpPayload): AntigravityMcpPayload {
  const servers = pickServers(payload)
  const { servers: _legacyServers, inputs: _legacyInputs, ...rest } = payload
  return {
    ...rest,
    mcpServers: servers
  }
}

/**
 * Selects the server mapping from the payload preferring `mcpServers` and falling back to legacy `servers`.
 *
 * @param payload - MCP payload that may contain `mcpServers` (current) or `servers` (legacy)
 * @returns The selected servers mapping, or an empty object if neither field contains a plain object
 */
function pickServers(payload: AntigravityMcpPayload): Record<string, unknown> {
  if (isRecord(payload.mcpServers)) {
    return payload.mcpServers
  }
  if (isRecord(payload.servers)) {
    return payload.servers
  }
  return {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
