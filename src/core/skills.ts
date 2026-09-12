import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readdir, readFile, readlink, realpath, rename, stat, symlink } from 'node:fs/promises'
import { copyDir, ensureDir, pathExists, removeIfExists, resolveDirectoryPath, writeTextAtomic } from './fs.js'
import { getProjectPaths, type ProjectPathKey } from './paths.js'
import { discoverSkills, type DiscoveredSkill, type SkillDiscoveryResult } from './skillsDiscovery.js'
import type { IntegrationName } from '../types.js'

/** Marker used to identify physical skill bridges managed by agents. */
export const BRIDGE_MARKER_FILENAME = '.agents_bridge'

/**
 * A tool that reads skills from its own directory rather than from `.agents/skills`.
 * The sync points that directory at the source, so the tool needs no copy of its own.
 */
export interface SkillBridgeDefinition {
  integration: IntegrationName
  /**
   * Directory the tool reads skills from. The directory to create is derived from this
   * path rather than kept as a second key: Kilo keeps kilo.jsonc under the XDG config
   * directory and its skills under the home directory, so a separate key would point
   * the sync at the wrong parent in global mode.
   */
  pathKey: ProjectPathKey
  /** Path as it is shown in warnings and in `agents status`. */
  label: string
  /** `.gitignore` entry in source-only mode, where a broader entry does not already cover it. */
  gitignoreEntry?: string
}

/**
 * Every skill bridge the sync owns, in the order it writes them.
 *
 * Tools that discover `.agents/skills` on their own are absent here and carry
 * `nativeSkills` in the integration registry instead.
 */
export const SKILL_BRIDGES: SkillBridgeDefinition[] = [
  {
    integration: 'claude',
    pathKey: 'claudeSkillsBridge',
    label: '.claude/skills',
    gitignoreEntry: '.claude/skills'
  },
  { integration: 'cursor', pathKey: 'cursorSkillsBridge', label: '.cursor/skills' },
  { integration: 'gemini', pathKey: 'geminiSkillsBridge', label: '.gemini/skills' },
  { integration: 'windsurf', pathKey: 'windsurfSkillsBridge', label: '.windsurf/skills' },
  {
    integration: 'junie',
    pathKey: 'junieSkillsBridge',
    label: '.junie/skills',
    gitignoreEntry: '.junie/skills'
  },
  {
    integration: 'kilo',
    pathKey: 'kiloSkillsBridge',
    label: '.kilo/skills',
    gitignoreEntry: '.kilo/skills'
  }
]

/** `.gitignore` entries for the bridges, used by the source-only sync mode. */
export const SKILL_BRIDGE_GITIGNORE_ENTRIES: string[] = SKILL_BRIDGES.flatMap((bridge) =>
  bridge.gitignoreEntry ? [bridge.gitignoreEntry] : [],
)

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

  for (const bridge of SKILL_BRIDGES) {
    // Antigravity does not follow symlinks, so it replaces the Gemini bridge with a flat copy.
    if (bridge.integration === 'gemini' && antigravityEnabled) {
      await syncAntigravitySkillsBridge({
        enabled: hasSkills,
        projectRoot,
        parentDir: path.dirname(paths[bridge.pathKey]),
        bridgePath: paths[bridge.pathKey],
        sourcePath: paths.agentsSkillsDir,
        label: bridge.label,
        check,
        changed,
        warnings,
        discovery
      })
      continue
    }

    await syncToolSkillsBridge({
      enabled: enabledIntegrations.includes(bridge.integration) && hasSkills,
      projectRoot,
      parentDir: path.dirname(paths[bridge.pathKey]),
      bridgePath: paths[bridge.pathKey],
      sourcePath: paths.agentsSkillsDir,
      label: bridge.label,
      check,
      changed,
      warnings
    })
  }

  warnings.push(...collectNestedSkillWarnings(enabledIntegrations, discovery))

  await cleanupLegacyAntigravityBridge({
    projectRoot,
    check,
    changed
  })
}

/**
 * Warn about skills a tool cannot see because of where they sit.
 *
 * Zed only reads skills that are direct children of the skills root, so a grouping
 * directory hides every skill under it without any error of its own.
 */
function collectNestedSkillWarnings(
  enabledIntegrations: IntegrationName[],
  discovery: SkillDiscoveryResult,
): string[] {
  if (!enabledIntegrations.includes('zed')) return []

  const nested = discovery.skills.filter((skill) => skill.relativePath.includes('/'))
  if (nested.length === 0) return []

  const paths = nested.map((skill) => skill.relativePath).join(', ')
  return [
    `Zed only discovers skills directly under .agents/skills, so it will not load: ${paths}. `
      + 'Move them to the top level of .agents/skills to make Zed see them.'
  ]
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
      // A link to somewhere else is the user's own arrangement, such as a shared skills
      // directory. Replacing it silently loses it; the flat Antigravity bridge already
      // refuses in the same situation.
      warnings.push(
        `Found existing ${label} pointing somewhere else (${current}); left untouched. `
          + 'Remove it to let the sync manage the bridge.',
      )
      return
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


interface EscapingSkillLink {
  skill: DiscoveredSkill
  link: string
}

/**
 * Split skills into those safe to dereference and those holding a symlink that leaves
 * the project.
 *
 * A flat copy follows symlinks, which is how a skill kept elsewhere in the repository
 * reaches the bridge. A link to `~/.ssh/id_rsa` would arrive the same way, as a real
 * file inside the project, so the boundary is the project root rather than the skills
 * directory.
 */
async function partitionEscapingSkills(
  skills: DiscoveredSkill[],
  projectRoot: string,
): Promise<{ safe: DiscoveredSkill[]; escaping: EscapingSkillLink[] }> {
  const root = await resolveDirectoryPath(projectRoot)
  const safe: DiscoveredSkill[] = []
  const escaping: EscapingSkillLink[] = []

  for (const skill of skills) {
    const link = await findEscapingLink(skill.sourcePath, skill.sourcePath, root)
    if (link) escaping.push({ skill, link })
    else safe.push(skill)
  }

  return { safe, escaping }
}

/**
 * First symlink under `currentDir` whose target resolves outside `root`, if any.
 *
 * A symlink to a directory inside the project is followed rather than accepted: the copy
 * dereferences it, so a link that leaves the project can sit one level down inside it.
 * Visited real paths are remembered, because a link can point at its own ancestor.
 */
async function findEscapingLink(
  skillRoot: string,
  currentDir: string,
  root: string,
  visited: Set<string> = new Set<string>(),
): Promise<string | undefined> {
  const resolvedDir = await resolveDirectoryPath(currentDir)
  if (visited.has(resolvedDir)) return undefined
  visited.add(resolvedDir)

  let entries
  try {
    entries = await readdir(currentDir, { withFileTypes: true })
  } catch {
    return undefined
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name)
    if (entry.isSymbolicLink()) {
      let target: string
      try {
        target = await realpath(absolutePath)
      } catch {
        // A broken link copies as nothing; it cannot leak a file.
        continue
      }
      if (!isInside(root, target)) {
        return path.relative(skillRoot, absolutePath) || entry.name
      }
      // The link stays in the project, but what it points at may not.
      if (await isDirectoryTarget(absolutePath)) {
        const nested = await findEscapingLink(skillRoot, absolutePath, root, visited)
        if (nested) return nested
      }
      continue
    }

    if (entry.isDirectory()) {
      const nested = await findEscapingLink(skillRoot, absolutePath, root, visited)
      if (nested) return nested
    }
  }

  return undefined
}

/** Whether `candidate` is the directory itself or sits under it. */
function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
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

  // The flat copy dereferences symlinks, which is what makes a skill linked from
  // elsewhere in the repository work. A link that leaves the project is different: it
  // would put a copy of someone's file into the project, so that skill is left out. The
  // same list feeds the comparison below, so the bridge does not drift.
  const { safe: bridgedSkills, escaping } = await partitionEscapingSkills(discovery.skills, projectRoot)
  for (const item of escaping) {
    warnings.push(
      `Skill "${item.skill.relativePath}" links outside the project (${item.link}), so it is left out of the `
        + `${label} flat copy; copying it would place a file from outside the project into the repository.`,
    )
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
          inSync = await flatSkillDirectoriesEqual(bridgedSkills, bridgePath)
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
    await replaceAntigravitySkillsBridge(bridgedSkills, bridgePath)
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
