import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates } from '../src/core/updateCheck.js'

const tempDirs: string[] = []
const originalHome = process.env.HOME

afterEach(async () => {
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

describe('update checks', () => {
  it('stores update metadata in project local.json when present', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-check-'))
    tempDirs.push(projectRoot)

    await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      JSON.stringify({ mcpServers: {} }, null, 2),
      'utf8'
    )

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ version: '0.9.0' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    const result = await checkForUpdates({
      currentVersion: '0.8.2',
      projectRoot,
      forceRefresh: true
    })

    expect(result.latestVersion).toBe('0.9.0')
    expect(result.isOutdated).toBe(true)
    expect(result.source).toBe('network')

    const saved = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'local.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>
      meta?: { updateCheck?: { latestVersion?: string; lastSeenVersion?: string; lastCheckedAt?: string } }
    }
    expect(saved.mcpServers).toEqual({})
    expect(saved.meta?.updateCheck?.latestVersion).toBe('0.9.0')
    expect(saved.meta?.updateCheck?.lastSeenVersion).toBe('0.8.2')
    expect(typeof saved.meta?.updateCheck?.lastCheckedAt).toBe('string')
  })

  it('falls back to cache when registry request fails', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-check-'))
    tempDirs.push(projectRoot)

    await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      JSON.stringify({
        mcpServers: {},
        meta: {
          updateCheck: {
            latestVersion: '0.9.0',
            lastCheckedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      }, null, 2),
      'utf8'
    )

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))

    const result = await checkForUpdates({
      currentVersion: '0.8.2',
      projectRoot,
      forceRefresh: true
    })

    expect(result.latestVersion).toBe('0.9.0')
    expect(result.isOutdated).toBe(true)
    expect(result.source).toBe('cache-stale')
  })

  it('uses global cache path when project local.json is missing', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'agents-update-home-'))
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-update-project-'))
    tempDirs.push(homeDir, projectRoot)
    process.env.HOME = homeDir

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ version: '0.8.2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )

    const result = await checkForUpdates({
      currentVersion: '0.8.2',
      projectRoot,
      forceRefresh: true
    })

    expect(result.latestVersion).toBe('0.8.2')
    expect(result.isOutdated).toBe(false)
    const globalCache = JSON.parse(
      await readFile(path.join(homeDir, '.agents-dev', 'update-check.json'), 'utf8')
    ) as { meta?: { updateCheck?: { latestVersion?: string } } }
    expect(globalCache.meta?.updateCheck?.latestVersion).toBe('0.8.2')
  })
})
