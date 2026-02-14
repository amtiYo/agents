import path from 'node:path'
import type { AgentsConfig, IntegrationName, SyncMode } from '../types.js'
import { ensureDir, pathExists } from './fs.js'
import { createDefaultAgentsConfig, saveAgentsConfig } from './config.js'
import { getProjectPaths } from './paths.js'
import { scaffoldBaseTemplates } from './templates.js'

export async function initializeProjectSkeleton(args: {
  projectRoot: string
  force: boolean
  integrations: IntegrationName[]
  integrationOptions: AgentsConfig['integrations']['options']
  syncMode: SyncMode
  hideGeneratedInVscode: boolean
}): Promise<{ changed: string[]; warnings: string[] }> {
  const { projectRoot, force, integrations, integrationOptions, syncMode, hideGeneratedInVscode } = args

  const paths = getProjectPaths(projectRoot)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.generatedDir)
  await ensureDir(paths.agentsSkillsDir)

  const changed: string[] = []
  const warnings: string[] = []
  const scaffold = await scaffoldBaseTemplates(projectRoot, force)
  changed.push(...scaffold.changed)
  warnings.push(...scaffold.warnings)

  const config = createDefaultAgentsConfig({
    enabledIntegrations: integrations,
    integrationOptions,
    syncMode,
    hideGenerated: hideGeneratedInVscode
  })

  if (force || !(await pathExists(paths.agentsConfig))) {
    await saveAgentsConfig(projectRoot, config)
    changed.push(path.relative(projectRoot, paths.agentsConfig) || paths.agentsConfig)
  }

  return { changed, warnings }
}

export async function updateProjectState(args: {
  projectRoot: string
  config: AgentsConfig
}): Promise<void> {
  const { projectRoot, config } = args
  await saveAgentsConfig(projectRoot, config)
}

export async function projectInitialized(projectRoot: string): Promise<boolean> {
  const paths = getProjectPaths(projectRoot)
  return pathExists(paths.agentsConfig)
}
