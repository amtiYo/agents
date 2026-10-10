import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { performSync } from '../src/core/sync.js'
import { runWatch } from '../src/commands/watch.js'
import * as ui from '../src/core/ui.js'

vi.mock('../src/core/sync.js', () => ({ performSync: vi.fn() }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }))

const tempDirs: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  ui.setContext({ quiet: false })
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('watch retries', () => {
  it('retries the same source change after a transient failure, then settles', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-retry-'))
    tempDirs.push(projectRoot)
    const instructions = path.join(projectRoot, 'AGENTS.md')
    await writeFile(instructions, 'before')
    let cycle = 0
    vi.mocked(sleep).mockImplementation(async () => {
      cycle += 1
      if (cycle === 1) await writeFile(instructions, 'changed instructions')
      if (cycle === 4) process.emit('SIGINT')
    })
    vi.mocked(performSync)
      .mockRejectedValueOnce(new Error('Another sync is already running'))
      .mockResolvedValue({ changed: [], warnings: [] })

    await runWatch({ projectRoot, intervalMs: 200, once: false, quiet: true })

    expect(performSync).toHaveBeenCalledTimes(2)
  })
})
