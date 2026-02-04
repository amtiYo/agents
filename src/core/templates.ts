import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ensureDir, pathExists, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates/agents')

export async function scaffoldBaseTemplates(projectRoot: string, force: boolean): Promise<string[]> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.mcpDir)
  await ensureDir(paths.generatedDir)
  await ensureDir(paths.agentsSkillsDir)

  const pairs: Array<{ from: string; to: string }> = [
    { from: path.join(TEMPLATE_ROOT, 'AGENTS.md'), to: paths.agentsMd },
    { from: path.join(TEMPLATE_ROOT, 'README.md'), to: paths.agentsReadme },
    { from: path.join(TEMPLATE_ROOT, 'mcp', 'local.example.json'), to: paths.mcpLocalExample },
    { from: path.join(TEMPLATE_ROOT, 'skills', 'README.md'), to: path.join(paths.agentsSkillsDir, 'README.md') },
    {
      from: path.join(TEMPLATE_ROOT, 'skills', 'skill-guide', 'SKILL.md'),
      to: path.join(paths.agentsSkillsDir, 'skill-guide', 'SKILL.md')
    }
  ]

  const changed: string[] = []

  for (const pair of pairs) {
    if (!force && (await pathExists(pair.to))) {
      continue
    }
    await ensureDir(path.dirname(pair.to))
    await copyFile(pair.from, pair.to)
    changed.push(path.relative(projectRoot, pair.to) || pair.to)
  }

  if (!(await pathExists(paths.mcpLocal))) {
    await writeTextAtomic(paths.mcpLocal, '{\n  "mcpServers": {}\n}\n')
    changed.push(path.relative(projectRoot, paths.mcpLocal) || paths.mcpLocal)
  }

  return changed
}
