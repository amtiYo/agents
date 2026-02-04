import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { AgentsConfig, LinkMode } from '../types.js'
import { SCHEMA_VERSION } from '../types.js'

export function createDefaultConfig(projectRoot: string, linkMode: LinkMode): AgentsConfig {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectRoot: path.resolve(projectRoot),
    agentsMdPath: '.agents/AGENTS.md',
    enabledIntegrations: [],
    linkMode,
    lastSync: null
  }
}

export async function loadConfig(projectRoot: string): Promise<AgentsConfig> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.agentsConfig))) {
    throw new Error(`Missing config: ${paths.agentsConfig}. Run "agents init" first.`)
  }
  const config = await readJson<AgentsConfig>(paths.agentsConfig)
  if (config.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${String(config.schemaVersion)}. Expected ${String(SCHEMA_VERSION)}.`,
    )
  }
  return config
}

export async function saveConfig(projectRoot: string, config: AgentsConfig): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(path.dirname(paths.agentsConfig))
  await writeJsonAtomic(paths.agentsConfig, config)
}
