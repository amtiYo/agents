import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { pathExists } from './fs.js'

const SKILL_NAME_RE = /^[\p{Ll}\p{Nd}]+(?:-[\p{Ll}\p{Nd}]+)*$/u

export async function validateSkillsDirectory(skillsDir: string): Promise<string[]> {
  if (!(await pathExists(skillsDir))) return []

  const entries = await readdir(skillsDir, { withFileTypes: true })
  const warnings: string[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dirName = entry.name
    const skillPath = path.join(skillsDir, dirName, 'SKILL.md')
    if (!(await pathExists(skillPath))) {
      warnings.push(`Skill "${dirName}" is missing SKILL.md.`)
      continue
    }

    const raw = await readFile(skillPath, 'utf8')
    const frontmatter = extractFrontmatter(raw)
    if (!frontmatter) {
      warnings.push(`Skill "${dirName}" has no YAML frontmatter.`)
      continue
    }

    const name = frontmatter.name?.trim()
    const description = frontmatter.description?.trim()

    if (!name) {
      warnings.push(`Skill "${dirName}" is missing required frontmatter field "name".`)
    } else {
      if (name !== dirName) {
        warnings.push(`Skill "${dirName}" must match frontmatter name "${name}".`)
      }
      if (name.length > 64 || !SKILL_NAME_RE.test(name)) {
        warnings.push(`Skill "${dirName}" has invalid name format.`)
      }
    }

    if (!description) {
      warnings.push(`Skill "${dirName}" is missing required frontmatter field "description".`)
    } else if (description.length > 1024) {
      warnings.push(`Skill "${dirName}" description is longer than 1024 characters.`)
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
