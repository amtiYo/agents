import os from 'node:os'
import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'

export interface WindsurfMcpPayload {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export function getWindsurfGlobalMcpPath(): string {
  const override = process.env.AGENTS_WINDSURF_MCP_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }

  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json')
}

export async function readWindsurfMcp(pathToRead: string): Promise<WindsurfMcpPayload | undefined> {
  if (!(await pathExists(pathToRead))) return undefined
  return readJson<WindsurfMcpPayload>(pathToRead)
}

export async function writeWindsurfMcp(pathToWrite: string, payload: WindsurfMcpPayload): Promise<void> {
  await ensureDir(path.dirname(pathToWrite))
  await writeJsonAtomic(pathToWrite, normalizeWindsurfMcpPayload(payload))
}

export function normalizeWindsurfMcpPayload(payload: WindsurfMcpPayload): WindsurfMcpPayload {
  return {
    ...payload,
    mcpServers: isRecord(payload.mcpServers) ? payload.mcpServers : {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
