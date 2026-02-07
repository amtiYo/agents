import { open, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir } from './fs.js'

const DEFAULT_STALE_MS = 5 * 60_000

interface LockMetadata {
  pid?: number
  startedAt?: string
}

export async function acquireSyncLock(lockPath: string, staleMs = DEFAULT_STALE_MS): Promise<() => Promise<void>> {
  await ensureDir(path.dirname(lockPath))

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        const metadata: LockMetadata = {
          pid: process.pid,
          startedAt: new Date().toISOString()
        }
        await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
      } finally {
        await handle.close()
      }

      return async (): Promise<void> => {
        await rm(lockPath, { force: true })
      }
    } catch (error) {
      const code = getErrorCode(error)
      if (code !== 'EEXIST') {
        throw error
      }

      const stale = await isLockStale(lockPath, staleMs)
      if (stale) {
        await rm(lockPath, { force: true })
        continue
      }

      throw new Error(buildLockBusyMessage(lockPath, await readLockMetadata(lockPath)))
    }
  }

  throw new Error(`Failed to acquire sync lock at ${lockPath}.`)
}

function buildLockBusyMessage(lockPath: string, metadata: LockMetadata | null): string {
  if (!metadata) {
    return `Another sync is already running for this project (${lockPath}). Try again in a few seconds.`
  }

  const parts: string[] = []
  if (typeof metadata.pid === 'number') parts.push(`pid=${String(metadata.pid)}`)
  if (typeof metadata.startedAt === 'string' && metadata.startedAt.trim().length > 0) {
    parts.push(`startedAt=${metadata.startedAt}`)
  }

  if (parts.length === 0) {
    return `Another sync is already running for this project (${lockPath}). Try again in a few seconds.`
  }

  return `Another sync is already running for this project (${lockPath}, ${parts.join(', ')}). Try again in a few seconds.`
}

async function isLockStale(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    const ageMs = Date.now() - info.mtimeMs
    return ageMs > staleMs
  } catch {
    return true
  }
}

async function readLockMetadata(lockPath: string): Promise<LockMetadata | null> {
  try {
    const raw = await readFile(lockPath, 'utf8')
    const parsed = JSON.parse(raw) as LockMetadata
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

function getErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('code' in value)) return undefined
  const code = (value as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}
