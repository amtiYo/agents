import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFile } from 'node:fs/promises'
import { ensureDir, pathExists } from './fs.js'
import { getProjectPaths } from './paths.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMPLATE_ROOT = path.resolve(__dirname, '../../templates/agents')

export async function scaffoldTemplates(projectRoot: string, force: boolean): Promise<string[]> {
  const paths = getProjectPaths(projectRoot)
  await ensureDir(paths.agentsDir)
  await ensureDir(paths.mcpDir)
  await ensureDir(paths.generatedDir)

  const pairs: Array<{ from: string; to: string }> = [
    { from: path.join(TEMPLATE_ROOT, 'AGENTS.md'), to: paths.agentsMd },
    { from: path.join(TEMPLATE_ROOT, 'README.md'), to: paths.agentsReadme },
    { from: path.join(TEMPLATE_ROOT, 'mcp', 'registry.json'), to: paths.mcpRegistry },
    { from: path.join(TEMPLATE_ROOT, 'mcp', 'local.example.json'), to: paths.mcpLocalExample }
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

  return changed
}
