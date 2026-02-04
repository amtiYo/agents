import { randomUUID } from 'node:crypto'
import { access, cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    try {
      await lstat(filePath)
      return true
    } catch {
      return false
    }
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath))
  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(tmpPath, content, 'utf8')
  await rename(tmpPath, filePath)
}

export async function removeIfExists(filePath: string): Promise<void> {
  if (await pathExists(filePath)) {
    await rm(filePath, { recursive: true, force: true })
  }
}

export async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await stat(dirPath)).isDirectory()
  } catch {
    return false
  }
}

export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isSymbolicLink()
  } catch {
    return false
  }
}

export async function readTextOrEmpty(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) return ''
  return readFile(filePath, 'utf8')
}

export async function listDirNames(dirPath: string): Promise<string[]> {
  if (!(await isDirectory(dirPath))) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

export async function copyDir(fromDir: string, toDir: string): Promise<void> {
  await ensureDir(path.dirname(toDir))
  await cp(fromDir, toDir, { recursive: true, force: true })
}
