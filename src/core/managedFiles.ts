import path from 'node:path'
import { readTextOrEmpty, writeTextAtomic } from './fs.js'

export function toChangedEntry(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath)
  if (relative.length === 0) return absolutePath
  if (relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath
  return relative
}

export async function writeManagedFile(args: {
  absolutePath: string
  content: string
  projectRoot: string
  check: boolean
  changed: string[]
}): Promise<void> {
  const { absolutePath, content, projectRoot, check, changed } = args
  const previous = await readTextOrEmpty(absolutePath)
  if (previous === content) return

  changed.push(toChangedEntry(projectRoot, absolutePath))

  if (check) return
  await writeTextAtomic(absolutePath, content)
}

