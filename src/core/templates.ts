import path from 'node:path'
import { copyFile, lstat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ensureDir, pathExists, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates/agents')

export async function scaffoldBaseTemplates(
  projectRoot: string,
  force: boolean,
): Promise<{ changed: string[]; warnings: string[] }> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.generatedDir)
  await ensureDir(paths.agentsSkillsDir)

  const pairs: Array<{ from: string; to: string }> = [
    { from: path.join(TEMPLATE_ROOT, 'AGENTS.md'), to: paths.rootAgentsMd },
    { from: path.join(TEMPLATE_ROOT, 'README.md'), to: paths.agentsReadme },
    { from: path.join(TEMPLATE_ROOT, 'skills', 'README.md'), to: path.join(paths.agentsSkillsDir, 'README.md') },
    {
      from: path.join(TEMPLATE_ROOT, 'skills', 'skill-guide', 'SKILL.md'),
      to: path.join(paths.agentsSkillsDir, 'skill-guide', 'SKILL.md')
    }
  ]

  const changed: string[] = []
  const warnings: string[] = []

  for (const pair of pairs) {
    const exists = await pathExists(pair.to)

    if (pair.to === paths.rootAgentsMd && exists) {
      const info = await lstat(pair.to)
      if (!info.isFile()) {
        warnings.push('AGENTS.md exists and is not a regular file (symlink/directory). Skipped overwrite.')
      }
      continue
    }

    if (!force && exists) {
      continue
    }
    await ensureDir(path.dirname(pair.to))
    await copyFile(pair.from, pair.to)
    changed.push(path.relative(projectRoot, pair.to) || pair.to)
  }

  if (!(await pathExists(paths.agentsLocal))) {
    await writeTextAtomic(paths.agentsLocal, '{\n  "mcpServers": {}\n}\n')
    changed.push(path.relative(projectRoot, paths.agentsLocal) || paths.agentsLocal)
  }

  return { changed, warnings }
}
