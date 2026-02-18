import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'

export interface OpencodeConfig {
  mcp?: Record<string, unknown>
  [key: string]: unknown
}

export async function readOpencodeConfig(configPath: string): Promise<OpencodeConfig> {
  if (!(await pathExists(configPath))) {
    return {}
  }
  return readJson<OpencodeConfig>(configPath)
}

export async function writeOpencodeConfig(configPath: string, config: OpencodeConfig): Promise<void> {
  await ensureDir(path.dirname(configPath))
  await writeJsonAtomic(configPath, normalizeOpencodeConfig(config))
}

export function normalizeOpencodeConfig(config: OpencodeConfig): OpencodeConfig {
  return {
    ...config,
    mcp: isRecord(config.mcp) ? config.mcp : {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
