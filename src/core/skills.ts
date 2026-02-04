import path from 'node:path'
import { copyDir, ensureDir, listDirNames, pathExists, readJson, readTextOrEmpty, removeIfExists, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { CatalogFile, ProjectConfig } from '../types.js'

interface SkillsState {
  managedSkillIds: string[]
  bridgeMode: 'symlink' | 'copy' | 'none'
}

const DEFAULT_STATE: SkillsState = {
  managedSkillIds: [],
  bridgeMode: 'none'
}

export async function syncSkills(args: {
  projectRoot: string
  config: ProjectConfig
  catalog: CatalogFile
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, config, catalog, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)
  const state = (await pathExists(paths.generatedSkillsState))
    ? await readJson<SkillsState>(paths.generatedSkillsState)
    : DEFAULT_STATE

  const desiredSkillIds = getDesiredSkillIds(config, catalog)

  await ensureDir(paths.agentsSkillsDir)

  const currentManaged = new Set(state.managedSkillIds)
  const desired = new Set(desiredSkillIds)

  for (const skillId of state.managedSkillIds) {
    if (desired.has(skillId)) continue
    const skillDir = path.join(paths.agentsSkillsDir, skillId)
    if (await pathExists(skillDir)) {
      changed.push(path.relative(projectRoot, skillDir) || skillDir)
      if (!check) {
        await removeIfExists(skillDir)
      }
    }
  }

  for (const skillId of desiredSkillIds) {
    const skill = catalog.skills[skillId]
    if (!skill) {
      warnings.push(`Unknown skill id "${skillId}" from selected packs/skills.`)
      continue
    }

    const skillDir = path.join(paths.agentsSkillsDir, skillId)
    const skillFile = path.join(skillDir, 'SKILL.md')
    const content = renderSkillMarkdown(skill)

    const previous = await readTextOrEmpty(skillFile)
    if (previous !== content) {
      changed.push(path.relative(projectRoot, skillFile) || skillFile)
      if (!check) {
        await ensureDir(skillDir)
        await writeTextAtomic(skillFile, content)
      }
    }
  }

  await syncClaudeSkillsBridge({
    projectRoot,
    claudeEnabled: config.enabledIntegrations.includes('claude'),
    check,
    changed,
    warnings
  })

  const nextState: SkillsState = {
    managedSkillIds: desiredSkillIds,
    bridgeMode: config.enabledIntegrations.includes('claude') ? 'symlink' : 'none'
  }

  if (!equalState(nextState, state)) {
    changed.push(path.relative(projectRoot, paths.generatedSkillsState) || paths.generatedSkillsState)
    if (!check) {
      await writeJsonAtomic(paths.generatedSkillsState, nextState)
    }
  }

  if (!check) {
    // keep deterministic order for future checks
    const names = await listDirNames(paths.agentsSkillsDir)
    for (const name of names) {
      if (currentManaged.has(name)) continue
      if (desired.has(name)) continue
    }
  }
}

function getDesiredSkillIds(config: ProjectConfig, catalog: CatalogFile): string[] {
  const set = new Set<string>()

  for (const packId of config.selectedSkillPacks) {
    const pack = catalog.skillPacks.find((item) => item.id === packId)
    if (!pack) continue
    for (const skillId of pack.skillIds) {
      set.add(skillId)
    }
  }

  for (const skillId of config.selectedSkills) {
    set.add(skillId)
  }

  return [...set].sort((a, b) => a.localeCompare(b))
}

function renderSkillMarkdown(skill: { name: string; description: string; instructions: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.instructions}\n`
}

async function syncClaudeSkillsBridge(args: {
  projectRoot: string
  claudeEnabled: boolean
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, claudeEnabled, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)

  if (!claudeEnabled) {
    return
  }

  await ensureDir(paths.claudeDir)

  const bridgePath = paths.claudeSkillsBridge
  const expectedRelative = '../.agents/skills'

  const exists = await pathExists(bridgePath)
  if (exists) {
    const linkInfo = await import('node:fs/promises').then(({ lstat }) => lstat(bridgePath))
    if (linkInfo.isSymbolicLink()) {
      const current = await import('node:fs/promises').then(({ readlink }) => readlink(bridgePath))
      if (current === expectedRelative) {
        return
      }
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (!check) {
        await removeIfExists(bridgePath)
      }
    } else {
      const marker = path.join(bridgePath, '.agents_bridge')
      if (await pathExists(marker)) {
        if (!check) {
          await copyDir(paths.agentsSkillsDir, bridgePath)
        }
        return
      } else {
        warnings.push(`Found existing .claude/skills that is not managed by agents: ${bridgePath}`)
        return
      }
    }
  }

  changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
  if (check) return

  try {
    const { symlink } = await import('node:fs/promises')
    await symlink(expectedRelative, bridgePath)
  } catch (error) {
    await copyDir(paths.agentsSkillsDir, bridgePath)
    await writeTextAtomic(path.join(bridgePath, '.agents_bridge'), 'managed-by-agents\n')
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`Claude skills bridge fallback to copy mode: ${message}`)
  }
}

function equalState(a: SkillsState, b: SkillsState): boolean {
  if (a.bridgeMode !== b.bridgeMode) return false
  if (a.managedSkillIds.length !== b.managedSkillIds.length) return false
  for (let i = 0; i < a.managedSkillIds.length; i += 1) {
    if (a.managedSkillIds[i] !== b.managedSkillIds[i]) return false
  }
  return true
}
