import path from 'node:path'
import { MCP_SELECTION_SCHEMA_VERSION } from '../types.js'
import type { LinkMode, McpSelection, ProjectConfig, SyncMode } from '../types.js'
import { ensureDir, pathExists, writeJsonAtomic } from './fs.js'
import { createDefaultProjectConfig, saveProjectConfig } from './config.js'
import { getProjectPaths } from './paths.js'
import { scaffoldBaseTemplates } from './templates.js'
import { ensureRootAgentsLink } from './linking.js'

export async function initializeProjectSkeleton(args: {
  projectRoot: string
  force: boolean
  integrations: ProjectConfig['enabledIntegrations']
  syncMode: SyncMode
  selectedSkillPacks: string[]
  selectedSkills: string[]
  preset: string
  selectedMcpServers: string[]
}): Promise<{ changed: string[]; linkMode: LinkMode; linkWarning?: string }> {
  const { projectRoot, force, integrations, syncMode, selectedSkillPacks, selectedSkills, preset, selectedMcpServers } =
    args

  const paths = getProjectPaths(projectRoot)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.mcpDir)
  await ensureDir(paths.generatedDir)
  await ensureDir(paths.agentsSkillsDir)

  const changed: string[] = []
  changed.push(...(await scaffoldBaseTemplates(projectRoot, force)))

  const link = await ensureRootAgentsLink(projectRoot, { forceReplace: force })

  const config = createDefaultProjectConfig(projectRoot, link.mode)
  config.enabledIntegrations = [...integrations]
  config.syncMode = syncMode
  config.selectedSkillPacks = [...selectedSkillPacks]
  config.selectedSkills = [...selectedSkills]

  await saveProjectConfig(projectRoot, config)
  changed.push(path.relative(projectRoot, paths.agentsProject) || paths.agentsProject)

  const selection: McpSelection = {
    schemaVersion: MCP_SELECTION_SCHEMA_VERSION,
    preset,
    selectedMcpServers: [...new Set(selectedMcpServers)].sort((a, b) => a.localeCompare(b))
  }
  await writeJsonAtomic(paths.mcpSelection, selection)
  changed.push(path.relative(projectRoot, paths.mcpSelection) || paths.mcpSelection)

  return {
    changed,
    linkMode: link.mode,
    linkWarning: link.warning
  }
}

export async function updateProjectState(args: {
  projectRoot: string
  config: ProjectConfig
  selection?: McpSelection
}): Promise<void> {
  const { projectRoot, config, selection } = args
  const paths = getProjectPaths(projectRoot)
  await saveProjectConfig(projectRoot, config)
  if (selection) {
    await writeJsonAtomic(paths.mcpSelection, selection)
  }
}

export async function projectInitialized(projectRoot: string): Promise<boolean> {
  const paths = getProjectPaths(projectRoot)
  return pathExists(paths.agentsProject)
}
