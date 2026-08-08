import { readFile } from 'node:fs/promises'
import { discoverSkills } from './skillsDiscovery.js'

const SKILL_NAME_RE = /^[\p{Ll}\p{Nd}]+(?:-[\p{Ll}\p{Nd}]+)*$/u

export async function validateSkillsDirectory(skillsDir: string): Promise<string[]> {
  const warnings: string[] = []
  const discovery = await discoverSkills(skillsDir)

  for (const duplicate of discovery.duplicates) {
    warnings.push(
      `Skill name "${duplicate.name}" is duplicated at ${duplicate.relativePaths.join(', ')}; flat skill bridges require unique names.`,
    )
  }

  for (const skill of discovery.skills) {
    const raw = await readFile(skill.skillFilePath, 'utf8')
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
        warnings.push(`Skill "${skill.relativePath}" must match frontmatter name "${name}".`)
      }
      if (name.length > 64 || !SKILL_NAME_RE.test(name)) {
        warnings.push(`Skill "${skill.relativePath}" has invalid name format.`)
      }
    }

    if (!description) {
      warnings.push(`Skill "${skill.relativePath}" is missing required frontmatter field "description".`)
    } else if (description.length > 300) {
      warnings.push(`Skill "${skill.relativePath}" description is longer than 300 characters.`)
    }
  }

  return warnings
}

function extractFrontmatter(raw: string): Record<string, string> | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u)
  if (!match) return null
  const body = match[1]
  if (!body) return {}

  const out: Record<string, string> = {}
  for (const line of body.split('\n')) {
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
