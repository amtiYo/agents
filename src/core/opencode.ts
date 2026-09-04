import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
export {
  getOpencodeConfigPath,
  getOpencodeDir,
  getOpencodeGlobalConfigDir,
  getOpencodeGlobalConfigPath
} from './paths.js'

export interface OpencodeConfig {
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

/** Normalize an OpenCode configuration ensuring the mcp container is a valid record. */
export function normalizeOpencodeConfig(config: OpencodeConfig): OpencodeConfig {
  return {
    ...config,
    mcp: isRecord(config.mcp) ? config.mcp : {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
