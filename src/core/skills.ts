import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, readFile, readlink, rename, stat, symlink } from 'node:fs/promises'
import { copyDir, ensureDir, pathExists, removeIfExists, resolveDirectoryPath, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import { discoverSkills, type DiscoveredSkill, type SkillDiscoveryResult } from './skillsDiscovery.js'
import type { IntegrationName } from '../types.js'

/** Marker used to identify physical skill bridges managed by agents. */
export const BRIDGE_MARKER_FILENAME = '.agents_bridge'

export interface AntigravitySkillsBridgeHealth {
  expectedSkillNames: string[]
  duplicateNames: string[]
  exists: boolean
  physicalDirectory: boolean
  managed: boolean
  inSync: boolean
}

/** Inspect the Antigravity-compatible flat skill bridge without changing it. */
export async function inspectAntigravitySkillsBridge(
  sourcePath: string,
  bridgePath: string,
): Promise<AntigravitySkillsBridgeHealth> {
  const discovery = await discoverSkills(sourcePath)
  const base = {
    expectedSkillNames: discovery.skills.map((skill) => skill.name),
    duplicateNames: discovery.duplicates.map((duplicate) => duplicate.name),
    exists: await pathExists(bridgePath),
    physicalDirectory: false,
    managed: false,
    inSync: false
  }

  if (!base.exists || base.duplicateNames.length > 0) return base

  let info
  try {
    info = await lstat(bridgePath)
  } catch {
    return base
  }
  if (!info.isDirectory() || info.isSymbolicLink()) return base

  base.physicalDirectory = true
  base.managed = await pathExists(path.join(bridgePath, BRIDGE_MARKER_FILENAME))
  if (base.managed) {
    try {
      base.inSync = await flatSkillDirectoriesEqual(discovery.skills, bridgePath)
    } catch {
      base.inSync = false
    }
  }
  return base
}

/**
 * Synchronizes the project's agents skills directory into each supported integration's bridge location.
 *
 * Ensures the agents skills directory exists (unless `check` is true), detects whether any managed skill
 * directories are present, and for each supported integration will create, update, or remove that
 * integration's skills bridge according to whether the integration is enabled and skills exist.
 * Records affected paths in `changed`, may append warnings for unmanaged existing bridges, and finally
 * cleans up a legacy antigravity bridge if it is agent-managed and matches the current source.
 *
 * @param projectRoot - Path to the repository/project root
 * @param enabledIntegrations - List of integration names that should have active bridges
 * @param check - If true, perform a dry run: record potential changes in `changed` but do not modify the filesystem
 * @param changed - Array that will be appended with paths (relative when possible) of bridges and directories that would be or were changed/removed
 * @param warnings - Array that will be appended with human-readable warning messages encountered during synchronization
 */
export async function syncSkills(args: {
  projectRoot: string
  enabledIntegrations: IntegrationName[]
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, enabledIntegrations, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)

  if (!check) {
    await ensureDir(paths.agentsSkillsDir)
  }

  const discovery = await discoverSkills(paths.agentsSkillsDir)
  const hasSkills = discovery.skills.length > 0
  const antigravityEnabled = enabledIntegrations.includes('antigravity')

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

  if (antigravityEnabled) {
    await syncAntigravitySkillsBridge({
      enabled: hasSkills,
      projectRoot,
      parentDir: paths.geminiDir,
      bridgePath: paths.geminiSkillsBridge,
      sourcePath: paths.agentsSkillsDir,
      label: '.gemini/skills',
      check,
      changed,
      warnings,
      discovery
    })
  } else {
    await syncToolSkillsBridge({
      enabled: enabledIntegrations.includes('gemini') && hasSkills,
      projectRoot,
      parentDir: paths.geminiDir,
      bridgePath: paths.geminiSkillsBridge,
      sourcePath: paths.agentsSkillsDir,
      label: '.gemini/skills',
      check,
      changed,
      warnings
    })
  }

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

  await syncToolSkillsBridge({
    enabled: enabledIntegrations.includes('junie') && hasSkills,
    projectRoot,
    parentDir: paths.junieDir,
    bridgePath: paths.junieSkillsBridge,
    sourcePath: paths.agentsSkillsDir,
    label: '.junie/skills',
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

  if (!check) {
    await ensureDir(parentDir)
  }

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

/** Synchronize the physical flat skill bridge required by Antigravity. */
async function syncAntigravitySkillsBridge(args: {
  enabled: boolean
  projectRoot: string
  parentDir: string
  bridgePath: string
  sourcePath: string
  label: string
  check: boolean
  changed: string[]
  warnings: string[]
  discovery: SkillDiscoveryResult
}): Promise<void> {
  const { enabled, projectRoot, parentDir, bridgePath, sourcePath, label, check, changed, warnings, discovery } = args
  const expectedRelative = path.relative(path.dirname(bridgePath), sourcePath) || '.'

  if (!enabled) {
    const removed = await cleanupManagedBridge(bridgePath, expectedRelative, sourcePath)
    if (removed) {
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (!check) await removeIfExists(bridgePath)
    }
    return
  }

  if (discovery.duplicates.length > 0) {
    warnings.push(formatAntigravityDuplicateWarning(discovery))
    const managedBridge = await cleanupManagedBridge(bridgePath, expectedRelative, sourcePath)
    if (managedBridge) {
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (!check) await removeIfExists(bridgePath)
      warnings.push(`${label} bridge was removed until duplicate skill names are resolved.`)
    }
    return
  }

  if (!check) await ensureDir(parentDir)

  const exists = await pathExists(bridgePath)
  if (exists) {
    const bridgeInfo = await lstat(bridgePath)
    if (bridgeInfo.isSymbolicLink()) {
      const current = await readlink(bridgePath)
      const pointsToSource = current === expectedRelative || path.resolve(path.dirname(bridgePath), current) === sourcePath
      if (!pointsToSource) {
        warnings.push(`Found existing ${label} that is not managed by agents: ${bridgePath}`)
        return
      }
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      if (!check) await removeIfExists(bridgePath)
    } else if (bridgeInfo.isDirectory()) {
      const marker = path.join(bridgePath, BRIDGE_MARKER_FILENAME)
      if (await pathExists(marker)) {
        let inSync = false
        try {
          inSync = await flatSkillDirectoriesEqual(discovery.skills, bridgePath)
        } catch {
          inSync = false
        }
        if (inSync) return
        changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
      } else {
        warnings.push(`Found existing ${label} that is not managed by agents: ${bridgePath}`)
        return
      }
    } else {
      warnings.push(`Found existing ${label} that is not a directory or managed bridge: ${bridgePath}`)
      return
    }
  }

  if (!exists) changed.push(path.relative(projectRoot, bridgePath) || bridgePath)
  if (check) return

  try {
    await replaceAntigravitySkillsBridge(discovery.skills, bridgePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`${label} bridge could not be materialized in flat copy mode: ${message}`)
  }
}

/** Compare discovered skill sources with their physical flat bridge copies. */
async function flatSkillDirectoriesEqual(skills: DiscoveredSkill[], bridgePath: string): Promise<boolean> {
  const entries = await readdir(bridgePath, { withFileTypes: true })
  const visibleEntries = entries.filter((entry) => entry.name !== BRIDGE_MARKER_FILENAME)
  if (visibleEntries.length !== skills.length) return false

  for (const skill of skills) {
    const destinationPath = path.join(bridgePath, skill.name)
    if (!(await pathExists(destinationPath))) return false
    const destinationInfo = await lstat(destinationPath)
    if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) return false
    if (!(await skillDirectoriesEqual(skill.sourcePath, destinationPath, true))) return false
  }

  return true
}

/** Copy discovered skills into a flat physical bridge. */
async function copyFlatSkillDirectories(skills: DiscoveredSkill[], bridgePath: string): Promise<void> {
  await ensureDir(bridgePath)
  for (const skill of skills) {
    await copyDir(skill.sourcePath, path.join(bridgePath, skill.name), { dereference: true })
  }
}

/** Atomically replace the Antigravity bridge from a staged directory. */
async function replaceAntigravitySkillsBridge(skills: DiscoveredSkill[], bridgePath: string): Promise<void> {
  const stagingPath = path.join(path.dirname(bridgePath), `.agents-skills-${randomUUID()}`)
  try {
    await copyFlatSkillDirectories(skills, stagingPath)
    await writeTextAtomic(
      path.join(stagingPath, BRIDGE_MARKER_FILENAME),
      'managed-by-agents antigravity-flat-copy\n',
    )
    await removeIfExists(bridgePath)
    await rename(stagingPath, bridgePath)
  } catch (error) {
    await removeIfExists(stagingPath)
    throw error
  }
}

/** Format duplicate skill names for a user-facing Antigravity warning. */
function formatAntigravityDuplicateWarning(discovery: SkillDiscoveryResult): string {
  const details = discovery.duplicates
    .map((duplicate) => `"${duplicate.name}" (${duplicate.relativePaths.join(', ')})`)
    .join('; ')
  return `Antigravity skills sync skipped because skill names must be unique for flat copy mode: ${details}`
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
  return await pathExists(marker)
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

/** Compare two skill directories by their deterministic signatures. */
async function skillDirectoriesEqual(sourcePath: string, bridgePath: string, dereferenceSymlinks = false): Promise<boolean> {
  const [sourceSignature, bridgeSignature] = await Promise.all([
    directorySignature(sourcePath, false, dereferenceSymlinks),
    directorySignature(bridgePath, true, dereferenceSymlinks),
  ])
  return sourceSignature === bridgeSignature
}

/** Build a deterministic content signature for a directory tree. */
async function directorySignature(
  rootDir: string,
  ignoreBridgeMarker: boolean,
  dereferenceSymlinks: boolean,
): Promise<string> {
  if (!(await pathExists(rootDir))) {
    return 'missing'
  }

  const entries: string[] = []
  await walkDirectory(rootDir, rootDir, entries, ignoreBridgeMarker, dereferenceSymlinks, new Set<string>())
  return entries.join('\n')
}

/** Walk a directory while preventing only cycles in the current recursion branch. */
async function walkDirectory(
  rootDir: string,
  currentDir: string,
  entries: string[],
  ignoreBridgeMarker: boolean,
  dereferenceSymlinks: boolean,
  visitedDirectories: Set<string>,
): Promise<void> {
  if (dereferenceSymlinks) {
    const resolvedCurrentDir = await resolveDirectoryPath(currentDir)
    if (visitedDirectories.has(resolvedCurrentDir)) return
    visitedDirectories = new Set(visitedDirectories).add(resolvedCurrentDir)
  }

  const children = await readdir(currentDir, { withFileTypes: true })
  children.sort((a, b) => a.name.localeCompare(b.name))

  for (const child of children) {
    if (ignoreBridgeMarker && child.name === BRIDGE_MARKER_FILENAME) continue

    const absolute = path.join(currentDir, child.name)
    const relative = path.relative(rootDir, absolute).replaceAll(path.sep, '/')

    if (child.isDirectory() || (dereferenceSymlinks && child.isSymbolicLink() && await isDirectoryTarget(absolute))) {
      entries.push(`d:${relative}`)
      await walkDirectory(rootDir, absolute, entries, ignoreBridgeMarker, dereferenceSymlinks, visitedDirectories)
      continue
    }

    if (!child.isFile() && !(dereferenceSymlinks && child.isSymbolicLink())) {
      entries.push(`o:${relative}`)
      continue
    }

    let content: Buffer
    try {
      content = await readFile(absolute)
    } catch {
      entries.push(`o:${relative}`)
      continue
    }
    const digest = createHash('sha256').update(content).digest('hex')
    entries.push(`f:${relative}:${digest}`)
  }
}

/** Return whether a path resolves to a directory. */
async function isDirectoryTarget(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory()
  } catch {
    return false
  }
}
