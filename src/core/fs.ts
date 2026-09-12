import { randomUUID } from 'node:crypto'
import { access, chmod, copyFile as copyFileRaw, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/** Atomically write JSON with private target permissions (`0o600`). */
export async function writePrivateJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, 0o600)
}

/** Atomically replace a text file, optionally setting the replacement file mode. */
export async function writeTextAtomic(filePath: string, content: string, mode?: number): Promise<void> {
  await writeTextAtomicWithMode(filePath, content, mode)
}

/** Atomically write text with private target permissions (`0o600`). */
export async function writePrivateTextAtomic(filePath: string, content: string): Promise<void> {
  await writeTextAtomicWithMode(filePath, content, 0o600)
}

/**
 * Write through a sibling temporary file and atomically rename it into place.
 *
 * The rename replaces the inode, so the permissions of the file being overwritten are
 * carried over: a config the user restricted to 0600 must not come back world-readable
 * because this CLI rewrote it. An explicit `mode` still wins.
 */
async function writeTextAtomicWithMode(filePath: string, content: string, mode?: number): Promise<void> {
  await ensureDir(path.dirname(filePath))

  let targetMode = mode
  if (targetMode === undefined) {
    try {
      targetMode = (await stat(filePath)).mode & 0o777
    } catch {
      // A file that does not exist yet keeps the umask default.
    }
  }

  const tmpPath = `${filePath}.${randomUUID()}.tmp`
  try {
    await writeFile(tmpPath, content, { encoding: 'utf8', ...(targetMode === undefined ? {} : { mode: targetMode }) })
    if (targetMode !== undefined) {
      // writeFile honours mode only when it creates the file, and umask still applies.
      await chmod(tmpPath, targetMode)
    }
    await rename(tmpPath, filePath)
  } finally {
    await rm(tmpPath, { force: true })
  }
}

export async function removeIfExists(filePath: string): Promise<void> {
  await rm(filePath, { recursive: true, force: true })
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

/** Recursively copy a directory, optionally dereferencing symbolic links. */
export async function copyDir(fromDir: string, toDir: string, options?: { dereference?: boolean }): Promise<void> {
  await ensureDir(path.dirname(toDir))
  await cp(fromDir, toDir, {
    recursive: true,
    force: true,
    ...(options?.dereference === undefined ? {} : { dereference: options.dereference })
  })
}

/** Resolve a directory to its real path, falling back to an absolute path when resolution fails. */
export async function resolveDirectoryPath(directoryPath: string): Promise<string> {
  try {
    return await realpath(directoryPath)
  } catch {
    return path.resolve(directoryPath)
  }
}

/** Copy a file, creating the destination directory when it does not exist. */
export async function copyFile(fromPath: string, toPath: string): Promise<void> {
  await ensureDir(path.dirname(toPath))
  await copyFileRaw(fromPath, toPath)
}
