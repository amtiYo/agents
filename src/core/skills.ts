import path from 'node:path'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink, symlink } from 'node:fs/promises'
import { copyDir, ensureDir, pathExists, removeIfExists, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { IntegrationName } from '../types.js'

const BRIDGE_MARKER_FILENAME = '.agents_bridge'

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

  await syncToolSkillsBridge({
    enabled: enabledIntegrations.includes('windsurf') && hasSkills,
    projectRoot,
    parentDir: paths.windsurfDir,
    bridgePath: paths.windsurfSkillsBridge,
    sourcePath: paths.agentsSkillsDir,
    label: '.windsurf/skills',
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
      const marker = path.join(bridgePath, BRIDGE_MARKER_FILENAME)
      if (await pathExists(marker)) {
        const inSync = await skillDirectoriesEqual(sourcePath, bridgePath)
        if (inSync) return

        changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
        if (check) return

        await removeIfExists(bridgePath)
        await copyDir(sourcePath, bridgePath)
        await writeTextAtomic(path.join(bridgePath, BRIDGE_MARKER_FILENAME), 'managed-by-agents\n')
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
    await writeTextAtomic(path.join(bridgePath, BRIDGE_MARKER_FILENAME), 'managed-by-agents\n')
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

  const marker = path.join(bridgePath, BRIDGE_MARKER_FILENAME)
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

async function skillDirectoriesEqual(sourcePath: string, bridgePath: string): Promise<boolean> {
  const [sourceSignature, bridgeSignature] = await Promise.all([
    directorySignature(sourcePath, false),
    directorySignature(bridgePath, true),
  ])
  return sourceSignature === bridgeSignature
}

async function directorySignature(rootDir: string, ignoreBridgeMarker: boolean): Promise<string> {
  if (!(await pathExists(rootDir))) {
    return 'missing'
  }

  const entries: string[] = []
  await walkDirectory(rootDir, rootDir, entries, ignoreBridgeMarker)
  return entries.join('\n')
}

async function walkDirectory(
  rootDir: string,
  currentDir: string,
  entries: string[],
  ignoreBridgeMarker: boolean
): Promise<void> {
  const children = await readdir(currentDir, { withFileTypes: true })
  children.sort((a, b) => a.name.localeCompare(b.name))

  for (const child of children) {
    if (ignoreBridgeMarker && child.name === BRIDGE_MARKER_FILENAME) continue

    const absolute = path.join(currentDir, child.name)
    const relative = path.relative(rootDir, absolute).replaceAll(path.sep, '/')

    if (child.isDirectory()) {
      entries.push(`d:${relative}`)
      await walkDirectory(rootDir, absolute, entries, ignoreBridgeMarker)
      continue
    }

    if (!child.isFile()) {
      entries.push(`o:${relative}`)
      continue
    }

    const content = await readFile(absolute)
    const digest = createHash('sha256').update(content).digest('hex')
    entries.push(`f:${relative}:${digest}`)
  }
}
