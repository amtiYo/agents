import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathExists } from '../core/fs.js'

export interface FileStat {
  path: string
  mtimeMs: number
  size: number
}

export async function statFile(filePath: string): Promise<FileStat | null> {
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return null
    return { path: filePath, mtimeMs: Math.round(info.mtimeMs), size: info.size }
  } catch {
    return null
  }
}

/**
 * Recursively list files under `root` whose relative path matches `want`.
 *
 * Symlinks are not followed.
 */
export async function walkFiles(
  root: string,
  want: (filePath: string, name: string) => boolean,
  options?: { maxDepth?: number }
): Promise<string[]> {
  if (!(await pathExists(root))) return []
  const maxDepth = options?.maxDepth ?? 12
  const out: string[] = []

  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await visit(full, depth + 1)
        continue
      }
      if (entry.isFile() && want(full, entry.name)) {
        out.push(full)
      }
    }
  }

  await visit(root, 0)
  return out.sort()
}
