import path from 'node:path'
import { lstat, readdir, readlink, symlink } from 'node:fs/promises'
import { copyDir, ensureDir, pathExists, removeIfExists, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { IntegrationName } from '../types.js'

export async function syncSkills(args: {
  projectRoot: string
  enabledIntegrations: IntegrationName[]
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, enabledIntegrations, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)

  await ensureDir(paths.agentsSkillsDir)

  const hasSkills = await hasSkillDirectories(paths.agentsSkillsDir)

  await syncToolSkillsBridge({
    enabled: enabledIntegrations.includes('claude') && hasSkills,
    projectRoot,
    parentDir: paths.claudeDir,
    bridgePath: paths.claudeSkillsBridge,
    sourcePath: paths.agentsSkillsDir,
    label: '.claude/skills',
    check,
    changed,
    warnings
  })

  await syncToolSkillsBridge({
    enabled: enabledIntegrations.includes('cursor') && hasSkills,
    projectRoot,
    parentDir: paths.cursorDir,
    bridgePath: paths.cursorSkillsBridge,
    sourcePath: paths.agentsSkillsDir,
    label: '.cursor/skills',
    check,
    changed,
    warnings
  })

  await syncToolSkillsBridge({
    enabled: (enabledIntegrations.includes('gemini') || enabledIntegrations.includes('antigravity')) && hasSkills,
    projectRoot,
    parentDir: paths.geminiDir,
    bridgePath: paths.geminiSkillsBridge,
    sourcePath: paths.agentsSkillsDir,
    label: '.gemini/skills',
    check,
    changed,
    warnings
  })

  await cleanupLegacyAntigravityBridge({
    projectRoot,
    check,
    changed
  })
}

async function hasSkillDirectories(skillsDir: string): Promise<boolean> {
  if (!(await pathExists(skillsDir))) return false
  const entries = await readdir(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
    if (await pathExists(skillFile)) {
      return true
    }
  }
  return false
}

async function syncToolSkillsBridge(args: {
  enabled: boolean
  projectRoot: string
  parentDir: string
  bridgePath: string
  sourcePath: string
  label: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, projectRoot, parentDir, bridgePath, sourcePath, label, check, changed, warnings } = args
  const expectedRelative = path.relative(path.dirname(bridgePath), sourcePath) || '.'

  if (!enabled) {
    const removed = await cleanupManagedBridge(bridgePath, expectedRelative, sourcePath)
    if (removed) {
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (!check) {
        await removeIfExists(bridgePath)
      }
    }
    return
  }

  await ensureDir(parentDir)

  const exists = await pathExists(bridgePath)
  if (exists) {
    const linkInfo = await lstat(bridgePath)
    if (linkInfo.isSymbolicLink()) {
      const current = await readlink(bridgePath)
      if (current === expectedRelative || path.resolve(path.dirname(bridgePath), current) === sourcePath) {
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
          await copyDir(sourcePath, bridgePath)
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
    await copyDir(sourcePath, bridgePath)
    await writeTextAtomic(path.join(bridgePath, '.agents_bridge'), 'managed-by-agents\n')
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`${label} bridge fallback to copy mode: ${message}`)
  }
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
