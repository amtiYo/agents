import path from 'node:path'
import { cleanupManagedGitignore } from '../core/gitignore.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists, removeIfExists } from '../core/fs.js'

export interface ResetOptions {
  projectRoot: string
  localOnly: boolean
  hard: boolean
}

export async function runReset(options: ResetOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const paths = getProjectPaths(projectRoot)

  const targets = options.hard
    ? [
        paths.agentsDir,
        paths.rootAgentsMd,
        paths.codexDir,
        paths.geminiDir,
        paths.vscodeMcp,
        paths.claudeDir
      ]
    : options.localOnly
      ? [paths.codexDir, paths.geminiDir, paths.vscodeMcp, paths.claudeSkillsBridge]
      : [paths.generatedDir, paths.codexDir, paths.geminiDir, paths.vscodeMcp, paths.claudeSkillsBridge]

  const removed: string[] = []

  for (const target of targets) {
    if (!(await pathExists(target))) continue
    await removeIfExists(target)
    removed.push(path.relative(projectRoot, target) || target)
  }

  if (options.hard) {
    const gitignoreChanged = await cleanupManagedGitignore(projectRoot)
    if (gitignoreChanged) {
      removed.push('.gitignore (managed agents entries)')
    }
  }

  if (removed.length === 0) {
    process.stdout.write('Reset: nothing to clean.\n')
    return
  }

  const mode = options.hard ? 'hard' : options.localOnly ? 'local-only' : 'safe'
  process.stdout.write(`Reset (${mode}) cleaned ${removed.length} path(s):\n- ${removed.join('\n- ')}\n`)
}
