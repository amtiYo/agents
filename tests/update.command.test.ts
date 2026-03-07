import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runUpdate } from '../src/commands/update.js'
import { CLI_VERSION } from '../src/core/version.js'

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
        new Response(JSON.stringify({ version: '99.99.99' }), {
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

  it('warns when using stale cache and cannot confirm latest version', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-home-'))
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-project-'))
    tempDirs.push(homeDir, projectRoot)
    process.env.HOME = homeDir

    await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      JSON.stringify({
        mcpServers: {},
        meta: {
          updateCheck: {
            latestVersion: CLI_VERSION,
            lastCheckedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      }, null, 2),
      'utf8'
    )

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    const output = await captureStdout(async () => {
      await runUpdate({
        projectRoot,
        json: false,
        check: false
      })
    })

    expect(output).toContain('Could not confirm latest version')
    expect(output).not.toContain('Up to date')
  })

  it('returns exit code 1 in --check mode when using stale cache without confirmed newer version', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-home-'))
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-cmd-project-'))
    tempDirs.push(homeDir, projectRoot)
    process.env.HOME = homeDir

    await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      JSON.stringify({
        mcpServers: {},
        meta: {
          updateCheck: {
            latestVersion: CLI_VERSION,
            lastCheckedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      }, null, 2),
      'utf8'
    )

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    await runUpdate({
      projectRoot,
      json: false,
      check: true
    })

    expect(process.exitCode).toBe(1)
  })
})

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  ;(process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    chunks.push(chunk)
    return true
  }) as unknown as typeof process.stdout.write

  try {
    await fn()
  } finally {
    ;(process.stdout.write as unknown as typeof process.stdout.write) = originalWrite as unknown as typeof process.stdout.write
  }

  return chunks.join('')
}
