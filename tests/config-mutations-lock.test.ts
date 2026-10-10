import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig, loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { acquireSyncLock } from '../src/core/syncLock.js'
import { runProfileSet, runProfileUse, runProfileRemove } from '../src/commands/profile.js'
import { runConnect } from '../src/commands/connect.js'
import { runDisconnect } from '../src/commands/disconnect.js'
import { exportPlugin, importPlugin } from '../src/core/agentPlugin.js'

const tempDirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mutation-lock-'))
  tempDirs.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const config = createDefaultAgentsConfig()
  config.integrations.enabled = []
  config.mcp.servers = { test: { transport: 'stdio', command: 'node' } }
  config.profiles = { existing: { servers: ['test'] } }
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

const mutations = {
  set: (projectRoot: string) => runProfileSet({ projectRoot, name: 'new', servers: ['test'], sync: false, json: true }),
  use: (projectRoot: string) => runProfileUse({ projectRoot, name: 'existing', sync: false, json: true }),
  remove: (projectRoot: string) => runProfileRemove({ projectRoot, name: 'existing', sync: false, json: true }),
  connect: (projectRoot: string) => runConnect({ projectRoot, llm: 'junie', interactive: false, verbose: false }),
  disconnect: (projectRoot: string) => runDisconnect({ projectRoot, llm: 'junie', interactive: false, verbose: false }),
  import: (projectRoot: string) => importPlugin({ projectRoot, pluginDir: path.join(projectRoot, 'bundle') })
}

describe('configuration mutation locking', () => {
  it.each(Object.entries(mutations))('rejects %s before writing when sync owns the lock', async (_name, mutate) => {
    const projectRoot = await fixture()
    await exportPlugin({ projectRoot, outDir: path.join(projectRoot, 'bundle'), name: 'test-plugin' })
    const paths = getProjectPaths(projectRoot)
    const before = await readFile(paths.agentsConfig, 'utf8')
    const release = await acquireSyncLock(paths.generatedSyncLock)
    try {
      await expect(mutate(projectRoot)).rejects.toThrow(/already running/)
      expect(await readFile(paths.agentsConfig, 'utf8')).toBe(before)
    } finally {
      await release()
    }
  })

  it('reloads current configuration after an interactive selection', async () => {
    const projectRoot = await fixture()
    await runConnect({
      projectRoot, interactive: true, verbose: false,
      promptSelection: async () => {
        await runProfileSet({ projectRoot, name: 'added-while-prompting', servers: [], sync: false, json: true })
        return ['junie']
      }
    })
    expect((await loadAgentsConfig(projectRoot)).profiles?.['added-while-prompting']).toEqual({ servers: [] })
  })

  it('releases the lock after a rejected mutation', async () => {
    const projectRoot = await fixture()
    await expect(runProfileUse({ projectRoot, name: 'missing', sync: false, json: true })).rejects.toThrow(/not defined/)
    await runProfileSet({ projectRoot, name: 'after-error', servers: ['test'], sync: false, json: true })
    expect((await loadAgentsConfig(projectRoot)).profiles?.['after-error']).toEqual({ servers: ['test'] })
  })

})
