import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const watchRaceState = vi.hoisted(() => ({
  throwOnce: true,
  marker: '__race_target__',
  code: 'ENOENT'
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
  return {
    ...actual,
    lstat: async (target: Parameters<typeof actual.lstat>[0], ...args: Parameters<typeof actual.lstat> extends [unknown, ...infer R] ? R : never) => {
      const value = String(target)
      if (watchRaceState.throwOnce && value.includes(watchRaceState.marker)) {
        watchRaceState.throwOnce = false
        const error = new Error('transient missing file') as Error & { code?: string }
        error.code = watchRaceState.code
        throw error
      }
      return actual.lstat(target, ...args)
    }
  }
})

import { runInit } from '../src/commands/init.js'
import { runWatch } from '../src/commands/watch.js'

const tempDirs: string[] = []

beforeEach(() => {
  watchRaceState.throwOnce = true
  watchRaceState.code = 'ENOENT'
})

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('watch command resilience', () => {
  it('does not crash when a transient ENOENT happens during snapshot traversal', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-race-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'race-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, `${watchRaceState.marker}.txt`), 'race\n', 'utf8')

    const stopper = setTimeout(() => {
      process.emit('SIGINT')
    }, 250)

    try {
      await expect(
        runWatch({
          projectRoot,
          intervalMs: 200,
          once: false,
          quiet: true
        })
      ).resolves.toBeUndefined()
    } finally {
      clearTimeout(stopper)
    }
  })

  it('does not crash when a transient EPERM happens during snapshot traversal', async () => {
    watchRaceState.code = 'EPERM'
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-race-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'race-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, `${watchRaceState.marker}.txt`), 'race\n', 'utf8')

    const stopper = setTimeout(() => {
      process.emit('SIGINT')
    }, 250)

    try {
      await expect(
        runWatch({
          projectRoot,
          intervalMs: 200,
          once: false,
          quiet: true
        })
      ).resolves.toBeUndefined()
    } finally {
      clearTimeout(stopper)
    }
  })

  it('does not crash when a transient EACCES happens during snapshot traversal', async () => {
    watchRaceState.code = 'EACCES'
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-race-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'race-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, `${watchRaceState.marker}.txt`), 'race\n', 'utf8')

    const stopper = setTimeout(() => {
      process.emit('SIGINT')
    }, 250)

    try {
      await expect(
        runWatch({
          projectRoot,
          intervalMs: 200,
          once: false,
          quiet: true
        })
      ).resolves.toBeUndefined()
    } finally {
      clearTimeout(stopper)
    }
  })

  it('stops quickly on SIGINT even with long polling interval', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-race-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const started = Date.now()
    const stopper = setTimeout(() => {
      process.emit('SIGINT')
    }, 80)

    try {
      await runWatch({
        projectRoot,
        intervalMs: 60_000,
        once: false,
        quiet: true
      })
    } finally {
      clearTimeout(stopper)
    }

    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(2_000)
  })
})
