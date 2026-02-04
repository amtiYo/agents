import path from 'node:path'
import { copyFile, lstat, readFile, readlink, rm, symlink } from 'node:fs/promises'
import { pathExists } from './fs.js'

export interface LinkResult {
  mode: 'symlink' | 'copy'
  changed: boolean
  warning?: string
}

export async function ensureRootAgentsLink(
  projectRoot: string,
  options?: { forceReplace?: boolean },
): Promise<LinkResult> {
  const forceReplace = options?.forceReplace ?? false
  const rootAgents = path.join(projectRoot, 'AGENTS.md')
  const targetAbsolute = path.join(projectRoot, '.agents', 'AGENTS.md')
  const targetRelative = '.agents/AGENTS.md'

  if (!(await pathExists(targetAbsolute))) {
    throw new Error(`Missing target AGENTS file: ${targetAbsolute}`)
  }

  if (await pathExists(rootAgents)) {
    const info = await lstat(rootAgents)
    if (info.isSymbolicLink()) {
      const current = await readlink(rootAgents)
      if (current === targetRelative || path.resolve(projectRoot, current) === targetAbsolute) {
        return { mode: 'symlink', changed: false }
      }
    } else if (!forceReplace) {
      const currentContent = await readFile(rootAgents, 'utf8').catch(() => '')
      const targetContent = await readFile(targetAbsolute, 'utf8')
      if (currentContent !== targetContent) {
        throw new Error(
          `Refusing to replace existing AGENTS.md at ${rootAgents}. Re-run with --force to replace it.`,
        )
      }
    }
    await rm(rootAgents, { force: true })
  }

  try {
    await symlink(targetRelative, rootAgents)
    return { mode: 'symlink', changed: true }
  } catch (error) {
    await copyFile(targetAbsolute, rootAgents)
    const warning =
      error instanceof Error
        ? `Could not create symlink for AGENTS.md (${error.message}); used file copy fallback.`
        : 'Could not create symlink for AGENTS.md; used file copy fallback.'
    return { mode: 'copy', changed: true, warning }
  }
}
