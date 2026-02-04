import path from 'node:path'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { LinkMode, ProjectConfig } from '../types.js'
import { PROJECT_SCHEMA_VERSION } from '../types.js'

export function createDefaultProjectConfig(projectRoot: string, linkMode: LinkMode): ProjectConfig {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectRoot: path.resolve(projectRoot),
    agentsMdPath: '.agents/AGENTS.md',
    enabledIntegrations: [],
    linkMode,
    syncMode: 'source-only',
    selectedSkillPacks: [],
    selectedSkills: [],
    lastSync: null
  }
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const paths = getProjectPaths(projectRoot)
  if (!(await pathExists(paths.agentsProject))) {
    throw new Error(`Missing config: ${paths.agentsProject}. Run "agents start" first.`)
  }

  const config = await readJson<ProjectConfig>(paths.agentsProject)
  if (config.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version ${String(config.schemaVersion)}. Expected ${String(PROJECT_SCHEMA_VERSION)}.`,
    )
  }

  return config
}

export async function saveProjectConfig(projectRoot: string, config: ProjectConfig): Promise<void> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(path.dirname(paths.agentsProject))
  await writeJsonAtomic(paths.agentsProject, config)
}
