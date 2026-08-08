import path from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { pathExists, resolveDirectoryPath } from './fs.js'

const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules'])

export interface DiscoveredSkill {
  name: string
  relativePath: string
  sourcePath: string
  skillFilePath: string
}

export interface DuplicateSkillName {
  name: string
  relativePaths: string[]
}

export interface SkillDiscoveryResult {
  skills: DiscoveredSkill[]
  duplicates: DuplicateSkillName[]
}

/**
 * Find every skill directory containing a SKILL.md below the source root.
 * Grouping directories are allowed, while node_modules and VCS metadata are ignored.
 */
export async function discoverSkills(skillsDir: string): Promise<SkillDiscoveryResult> {
  if (!(await pathExists(skillsDir))) {
    return { skills: [], duplicates: [] }
  }

  const skills: DiscoveredSkill[] = []
  await walk(skillsDir, skillsDir, skills, new Set<string>())
  skills.sort((left, right) => left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath))

  const byName = new Map<string, DiscoveredSkill[]>()
  for (const skill of skills) {
    const group = byName.get(skill.name) ?? []
    group.push(skill)
    byName.set(skill.name, group)
  }

  const duplicates = [...byName.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({
      name,
      relativePaths: entries.map((entry) => entry.relativePath)
    }))
    .sort((left, right) => left.name.localeCompare(right.name))

  return { skills, duplicates }
}

/** Recursively collect skills while avoiding already-visited directory targets. */
async function walk(
  rootPath: string,
  currentPath: string,
  skills: DiscoveredSkill[],
  visitedDirectories: Set<string>,
): Promise<void> {
  const resolvedCurrentPath = await resolveDirectoryPath(currentPath)
  if (visitedDirectories.has(resolvedCurrentPath)) return
  visitedDirectories.add(resolvedCurrentPath)

  const entries = await readdir(currentPath, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue

    const absolutePath = path.join(currentPath, entry.name)
    if (await isDirectoryEntry(absolutePath, entry.isDirectory(), entry.isSymbolicLink())) {
      const skillFilePath = path.join(absolutePath, 'SKILL.md')
      if (await pathExists(skillFilePath)) {
        skills.push({
          name: entry.name,
          relativePath: toPortableRelativePath(path.relative(rootPath, absolutePath)),
          sourcePath: absolutePath,
          skillFilePath
        })
      }
      await walk(rootPath, absolutePath, skills, visitedDirectories)
    }
  }
}

/** Return whether a directory entry is or resolves to a directory. */
async function isDirectoryEntry(absolutePath: string, isDirectory: boolean, isSymbolicLink: boolean): Promise<boolean> {
  if (isDirectory) return true
  if (!isSymbolicLink) return false

  try {
    return (await stat(absolutePath)).isDirectory()
  } catch {
    return false
  }
}

/** Normalize a relative path to forward slashes for cross-platform output. */
function toPortableRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}
