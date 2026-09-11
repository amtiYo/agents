import { readFile } from 'node:fs/promises'
import { discoverSkills } from './skillsDiscovery.js'

const SKILL_NAME_RE = /^[\p{Ll}\p{Nd}]+(?:-[\p{Ll}\p{Nd}]+)*$/u
/** Agent Skills allows descriptions up to 1024 characters. */
const MAX_DESCRIPTION_LENGTH = 1024
const MAX_NAME_LENGTH = 64
/** Optional frontmatter fields defined by the Agent Skills specification. */
const KNOWN_OPTIONAL_FIELDS = new Set(['license', 'compatibility', 'metadata', 'allowed-tools'])

/**
 * Check every skill under a directory against the Agent Skills specification.
 *
 * @returns One warning per problem found; an empty array means the directory is clean.
 */
export async function validateSkillsDirectory(skillsDir: string): Promise<string[]> {
  const warnings: string[] = []
  const discovery = await discoverSkills(skillsDir)

  for (const duplicate of discovery.duplicates) {
    warnings.push(
      `Skill name "${duplicate.name}" is duplicated at ${duplicate.relativePaths.join(', ')}; flat skill bridges require unique names.`,
    )
  }

  for (const skill of discovery.skills) {
    let raw: string
    try {
      raw = await readFile(skill.skillFilePath, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Skill "${skill.relativePath}" could not be read: ${message}`)
      continue
    }
    const frontmatter = extractFrontmatter(raw)
    if (!frontmatter) {
      warnings.push(`Skill "${skill.relativePath}" has no YAML frontmatter.`)
      continue
    }

    const name = frontmatter.name?.trim()
    const description = frontmatter.description?.trim()

    if (!name) {
      warnings.push(`Skill "${skill.relativePath}" is missing required frontmatter field "name".`)
    } else {
      if (name !== skill.name) {
        warnings.push(`Skill directory "${skill.name}" at "${skill.relativePath}" does not match frontmatter name "${name}".`)
      }
      if (name.includes('--')) {
        warnings.push(`Skill "${skill.relativePath}" has consecutive hyphens in its name, which the spec disallows.`)
      } else if (name.length > MAX_NAME_LENGTH || !SKILL_NAME_RE.test(name)) {
        warnings.push(
          `Skill "${skill.relativePath}" has an invalid name: use 1-${String(MAX_NAME_LENGTH)} lowercase letters, digits and single hyphens.`,
        )
      }
    }

    if (!description) {
      warnings.push(`Skill "${skill.relativePath}" is missing required frontmatter field "description".`)
    } else if (description.length > MAX_DESCRIPTION_LENGTH) {
      warnings.push(
        `Skill "${skill.relativePath}" description is longer than ${String(MAX_DESCRIPTION_LENGTH)} characters.`,
      )
    }

    for (const key of Object.keys(frontmatter)) {
      if (key === 'name' || key === 'description') continue
      if (KNOWN_OPTIONAL_FIELDS.has(key)) continue
      warnings.push(
        `Skill "${skill.relativePath}" has frontmatter field "${key}", which is not part of the Agent Skills spec.`,
      )
    }
  }

  return warnings
}

/** Read top-level YAML frontmatter keys, ignoring nested blocks such as `metadata`. */
function extractFrontmatter(raw: string): Record<string, string> | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u)
  if (!match) return null
  const body = match[1]
  if (!body) return {}

  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
    // Indented lines belong to a nested block (for example the `metadata` map),
    // so they are not top-level frontmatter fields.
    if (/^\s/.test(line)) continue
    if (line.trimStart().startsWith('-')) continue
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    out[key] = value.replace(/^["']|["']$/g, '')
  }
  return out
}
