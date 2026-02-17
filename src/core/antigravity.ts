import os from 'node:os'
import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'

export interface AntigravityMcpPayload {
  servers?: Record<string, unknown>
  mcpServers?: Record<string, unknown>
  inputs?: unknown[]
  [key: string]: unknown
}

export function getAntigravityGlobalMcpPath(): string {
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

export function normalizeAntigravityMcpPayload(payload: AntigravityMcpPayload): AntigravityMcpPayload {
  const servers = pickServers(payload)
  return {
    ...payload,
    servers,
    mcpServers: servers
  }
}

function pickServers(payload: AntigravityMcpPayload): Record<string, unknown> {
  if (isRecord(payload.servers)) {
    return payload.servers
  }
  if (isRecord(payload.mcpServers)) {
    return payload.mcpServers
  }
  return {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
