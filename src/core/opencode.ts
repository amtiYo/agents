import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
