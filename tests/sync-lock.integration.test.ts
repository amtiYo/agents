import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('sync lock', () => {
  it('fails when an active lock exists', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-lock-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const generatedDir = path.join(projectRoot, '.agents', 'generated')
    await mkdir(generatedDir, { recursive: true })
    await writeFile(path.join(generatedDir, 'sync.lock'), `${JSON.stringify({ pid: 42, startedAt: new Date().toISOString() })}\n`, 'utf8')

    await expect(
      performSync({
        projectRoot,
        check: false,
        verbose: false
      }),
    ).rejects.toThrow(/Another sync is already running/)
  }, 15_000)

  it('replaces stale lock files and continues', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-lock-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const generatedDir = path.join(projectRoot, '.agents', 'generated')
    const lockPath = path.join(generatedDir, 'sync.lock')
    await mkdir(generatedDir, { recursive: true })
    await writeFile(lockPath, `${JSON.stringify({ pid: 99, startedAt: '2000-01-01T00:00:00.000Z' })}\n`, 'utf8')

    const staleAt = new Date(Date.now() - 10 * 60_000)
    await utimes(lockPath, staleAt, staleAt)

    const result = await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    expect(result.changed.length).toBeGreaterThan(0)
  }, 15_000)
})
