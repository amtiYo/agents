import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runUpdate } from '../src/commands/update.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
  process.exitCode = undefined
  vi.unstubAllGlobals()
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('update command', () => {
  it('returns exit code 10 in --check mode when update is available', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-home-'))
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-project-'))
    tempDirs.push(homeDir, projectRoot)
    process.env.HOME = homeDir

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ version: '0.9.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    await runUpdate({
      projectRoot,
      json: false,
      check: true
    })

    expect(process.exitCode).toBe(10)
  })

  it('returns exit code 1 in --check mode when latest version is unavailable', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-home-'))
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-project-'))
    tempDirs.push(homeDir, projectRoot)
    process.env.HOME = homeDir

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('registry unavailable')
    }))

    await runUpdate({
      projectRoot,
      json: false,
      check: true
    })

    expect(process.exitCode).toBe(1)
  })
})
