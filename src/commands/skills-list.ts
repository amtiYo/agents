import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { getProjectPaths } from '../core/paths.js'
import { discoverSkills } from '../core/skillsDiscovery.js'
import * as ui from '../core/ui.js'

export interface SkillsListOptions {
  projectRoot: string
  json: boolean
}

export interface SkillListItem {
  name: string
  path: string
  description: string
}

/**
 * List all discovered skills in .agents/skills with their relative paths and descriptions.
 *
 * @param options - Options controlling skill listing output (projectRoot, json)
 */
export async function runSkillsList(options: SkillsListOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const paths = getProjectPaths(options.projectRoot)
  const discovery = await discoverSkills(paths.agentsSkillsDir)

  const items: SkillListItem[] = []
  for (const skill of discovery.skills) {
    let description = ''
    try {
      const content = await readFile(skill.skillFilePath, 'utf8')
      const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u)
      if (match) {
        for (const line of match[1].split('\n')) {
          const trimmed = line.trim()
          if (trimmed.startsWith('description:')) {
            description = trimmed.slice('description:'.length).trim().replace(/^["']|["']$/g, '')
            break
          }
        }
      }
    } catch {
      // ignore read error
    }

    items.push({
      name: skill.name,
      path: skill.relativePath,
      description
    })
  }

  const payload = {
    projectRoot: path.resolve(options.projectRoot),
    skillsDir: paths.agentsSkillsDir,
    count: items.length,
    skills: items,
    duplicates: discovery.duplicates
  }

  if (options.json) {
    ui.json(payload)
    return
  }

  ui.keyValue('Project', payload.projectRoot)
  ui.keyValue('Skills dir', paths.agentsSkillsDir)
  ui.keyValue('Skills', String(payload.count))

  if (payload.count === 0) {
    ui.blank()
    ui.dim('No skills configured in .agents/skills.')
    return
  }

  ui.blank()
  for (const item of payload.skills) {
    const symbol = ui.color.green(ui.symbols.success)
    const pathSuffix = item.path !== item.name ? ` ${ui.color.dim(`(${item.path})`)}` : ''
    ui.writeln(`  ${symbol} ${ui.color.bold(item.name)}${pathSuffix}`)
    if (item.description) {
      ui.writeln(`      ${ui.color.dim(item.description)}`)
    }
  }

  if (discovery.duplicates.length > 0) {
    ui.blank()
    for (const dup of discovery.duplicates) {
      ui.warning(`Duplicate skill name "${dup.name}" found in: ${dup.relativePaths.join(', ')}`)
    }
  }
}
