import path from 'node:path'
import { copyDir, ensureDir, pathExists, readJson, readTextOrEmpty, removeIfExists, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { CatalogFile, ProjectConfig } from '../types.js'
import { lstat, readdir, readlink, symlink } from 'node:fs/promises'

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
  const hasManagedSkills = desiredSkillIds.length > 0

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
    claudeEnabled: config.enabledIntegrations.includes('claude') && hasManagedSkills,
    cursorEnabled: config.enabledIntegrations.includes('cursor') && hasManagedSkills,
    check,
    changed,
    warnings
  })
  await cleanupLegacyAntigravityBridge({
    projectRoot,
    check,
    changed
  })

  const nextState: SkillsState = {
    managedSkillIds: desiredSkillIds,
    bridgeMode:
      hasManagedSkills &&
      (config.enabledIntegrations.includes('claude') ||
      config.enabledIntegrations.includes('cursor'))
        ? 'symlink'
        : 'none'
  }

  if (!equalState(nextState, state)) {
    changed.push(path.relative(projectRoot, paths.generatedSkillsState) || paths.generatedSkillsState)
    if (!check) {
      await writeJsonAtomic(paths.generatedSkillsState, nextState)
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
  cursorEnabled: boolean
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, claudeEnabled, cursorEnabled, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)

  await syncToolSkillsBridge({
    enabled: claudeEnabled,
    projectRoot,
    parentDir: paths.claudeDir,
    bridgePath: paths.claudeSkillsBridge,
    label: '.claude/skills',
    check,
    changed,
    warnings
  })

  await syncToolSkillsBridge({
    enabled: cursorEnabled,
    projectRoot,
    parentDir: paths.cursorDir,
    bridgePath: paths.cursorSkillsBridge,
    label: '.cursor/skills',
    check,
    changed,
    warnings
  })
}

async function syncToolSkillsBridge(args: {
  enabled: boolean
  projectRoot: string
  parentDir: string
  bridgePath: string
  label: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, projectRoot, parentDir, bridgePath, label, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)
  const expectedRelative = path.relative(path.dirname(bridgePath), paths.agentsSkillsDir) || '.'

  if (!enabled) {
    const removed = await cleanupManagedBridge(bridgePath, expectedRelative, paths.agentsSkillsDir)
    if (removed) {
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (check) {
        return
      }
      await removeIfExists(bridgePath)
    }
    return
  }

  await ensureDir(parentDir)

  const exists = await pathExists(bridgePath)
  if (exists) {
    const linkInfo = await lstat(bridgePath)
    if (linkInfo.isSymbolicLink()) {
      const current = await readlink(bridgePath)
      if (current === expectedRelative || path.resolve(path.dirname(bridgePath), current) === paths.agentsSkillsDir) {
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
        warnings.push(`Found existing ${label} that is not managed by agents: ${bridgePath}`)
        return
      }
    }
  }

  changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
  if (check) return

  try {
    await symlink(expectedRelative, bridgePath)
  } catch (error) {
    await copyDir(paths.agentsSkillsDir, bridgePath)
    await writeTextAtomic(path.join(bridgePath, '.agents_bridge'), 'managed-by-agents\n')
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`${label} bridge fallback to copy mode: ${message}`)
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

async function cleanupManagedBridge(bridgePath: string, expectedRelative: string, expectedAbsolute: string): Promise<boolean> {
  if (!(await pathExists(bridgePath))) {
    return false
  }

  const info = await lstat(bridgePath)
  if (info.isSymbolicLink()) {
    const current = await readlink(bridgePath)
    return current === expectedRelative || path.resolve(path.dirname(bridgePath), current) === expectedAbsolute
  }

  const marker = path.join(bridgePath, '.agents_bridge')
  return pathExists(marker)
}

async function cleanupLegacyAntigravityBridge(args: {
  projectRoot: string
  check: boolean
  changed: string[]
}): Promise<void> {
  const { projectRoot, check, changed } = args
  const paths = getProjectPaths(projectRoot)
  const legacyDir = path.join(projectRoot, '.agent')
  const legacyBridgePath = path.join(legacyDir, 'skills')
  const expectedRelative = path.relative(path.dirname(legacyBridgePath), paths.agentsSkillsDir) || '.'

  const removable = await cleanupManagedBridge(legacyBridgePath, expectedRelative, paths.agentsSkillsDir)
  if (!removable) return

  changed.push(path.relative(projectRoot, legacyBridgePath) || legacyBridgePath)
  if (check) return

  await removeIfExists(legacyBridgePath)
  if (await pathExists(legacyDir)) {
    const entries = await readdir(legacyDir)
    if (entries.length === 0) {
      await removeIfExists(legacyDir)
      changed.push(path.relative(projectRoot, legacyDir) || legacyDir)
    }
  }
}
