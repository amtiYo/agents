import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('sync failure reporting', () => {
  it.each([true, false])('exits nonzero for an unreadable config (check=%s)', async check => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-errors-'))
    tempDirs.push(projectRoot)
    vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
    const config = createDefaultAgentsConfig()
    config.integrations.enabled = ['gemini']
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })
    const paths = getProjectPaths(projectRoot)
    await mkdir(path.dirname(paths.geminiSettings), { recursive: true })
    await writeFile(paths.geminiSettings, '{ broken')
    const state = await readFile(paths.generatedSyncState, 'utf8')
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const result = spawnSync(process.execPath, ['--import', 'tsx', cli, 'sync', '--path', projectRoot, ...(check ? ['--check'] : [])], {
      encoding: 'utf8', env: { ...process.env, AGENTS_NO_UPDATE_CHECK: '1' }
    })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain('Gemini')
    expect(result.stdout + result.stderr).not.toMatch(/No changes needed|Sync complete|Check complete/)
    expect(await readFile(paths.geminiSettings, 'utf8')).toBe('{ broken')
    expect(await readFile(paths.generatedSyncState, 'utf8')).toBe(state)
  })

  it('does not fail on a disabled tool whose manual file it never owned', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-unowned-'))
    tempDirs.push(projectRoot)
    vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
    const config = createDefaultAgentsConfig()
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })
    const paths = getProjectPaths(projectRoot)
    await mkdir(path.dirname(paths.geminiSettings), { recursive: true })
    await writeFile(paths.geminiSettings, '{ broken manual config')
    await expect(performSync({ projectRoot, check: false, verbose: false })).resolves.toBeDefined()
    expect(await readFile(paths.geminiSettings, 'utf8')).toBe('{ broken manual config')
  })

})
