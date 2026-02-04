import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ensureDir, pathExists, writeJsonAtomic, writeTextAtomic } from '../core/fs.js'
import { createDefaultConfig } from '../core/config.js'
import { ensureRootAgentsLink } from '../core/linking.js'
import { scaffoldTemplates } from '../core/templates.js'
import { getProjectPaths } from '../core/paths.js'

export interface InitOptions {
  projectRoot: string
  force: boolean
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const paths = getProjectPaths(projectRoot)

  if (!(await pathExists(projectRoot))) {
    throw new Error(`Project path does not exist: ${projectRoot}`)
  }

  await ensureDir(paths.agentsDir)
  const scaffolded = await scaffoldTemplates(projectRoot, options.force)

  const linkResult = await ensureRootAgentsLink(projectRoot, { forceReplace: options.force })
  const config = createDefaultConfig(projectRoot, linkResult.mode)

  if (options.force || !(await pathExists(paths.agentsConfig))) {
    await writeJsonAtomic(paths.agentsConfig, config)
  }

  if (!(await pathExists(paths.mcpLocal))) {
    await writeTextAtomic(paths.mcpLocal, '{\n  "mcpServers": {}\n}\n')
  }

  await ensureGitignoreEntries(paths.root, ['.agents/mcp/local.json', '.agents/generated/'])

  process.stdout.write(`Initialized .agents in ${projectRoot}\n`)
  if (scaffolded.length > 0) {
    process.stdout.write(`Created files:\n- ${scaffolded.join('\n- ')}\n`)
  }
  if (linkResult.warning) {
    process.stdout.write(`Warning: ${linkResult.warning}\n`)
  }
  process.stdout.write('Next: run "agents connect" to select AI integrations.\n')
}

async function ensureGitignoreEntries(projectRoot: string, entries: string[]): Promise<void> {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const exists = await pathExists(gitignorePath)
  const content = exists ? await readFile(gitignorePath, 'utf8') : ''
  const lines = content.split(/\r?\n/).filter(Boolean)

  let changed = false
  for (const entry of entries) {
    if (lines.includes(entry)) continue
    lines.push(entry)
    changed = true
  }

  if (!changed) return
  await writeTextAtomic(gitignorePath, `${lines.join('\n')}\n`)
}
