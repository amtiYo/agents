import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { INTEGRATION_SYNC_HOOKS } from '../src/integrations/syncHooks.js'
import type { IntegrationName } from '../src/types.js'

const tempDirs: string[] = []
const cases = [
  ['gemini', 'geminiSettings', 'mcpServers'],
  ['opencode', 'opencodeConfig', 'mcp'],
  ['cursor', 'cursorMcp', 'mcpServers'],
  ['copilot_vscode', 'vscodeMcp', 'servers'],
  ['junie', 'junieMcp', 'mcpServers']
] as const

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('sync config ownership', () => {
  it.each(cases)('preserves manual entries and removes stale managed entries for %s', async (id, pathKey, key) => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-ownership-'))
    tempDirs.push(projectRoot)
    vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
    const paths = getProjectPaths(projectRoot)
    const target = paths[pathKey]
    const hook = INTEGRATION_SYNC_HOOKS.find(hook => hook.id === id)!
    const manual = { command: 'manual-command' }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, JSON.stringify({ [key]: { manual }, custom: true }))
    const generatedByIntegration: Partial<Record<IntegrationName, string>> = {
      [id]: JSON.stringify({ [key]: { managed: { command: 'managed-command' } } })
    }
    const context = {
      projectRoot, paths, config: createDefaultAgentsConfig(), enabled: true,
      check: false, changed: [], warnings: [], generatedByIntegration
    }
    await hook.materialize!(context)
    let config = JSON.parse(await readFile(target, 'utf8'))
    expect(config[key].manual).toEqual(manual)
    expect(config.custom).toBe(true)
    expect(config[key].managed).toBeDefined()

    generatedByIntegration[id] = JSON.stringify({ [key]: {} })
    context.check = true
    await hook.materialize!(context)
    expect(JSON.parse(await readFile(target, 'utf8'))[key].managed).toBeDefined()
    context.check = false
    await hook.materialize!(context)
    config = JSON.parse(await readFile(target, 'utf8'))
    expect(config[key]).toEqual({ manual })
    expect(config.custom).toBe(true)
  })

  it('adopts only matching old preview entries on upgrade', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-upgrade-'))
    tempDirs.push(projectRoot)
    vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
    const paths = getProjectPaths(projectRoot)
    await mkdir(path.dirname(paths.cursorMcp), { recursive: true })
    await writeFile(paths.cursorMcp, JSON.stringify({ mcpServers: {
      stale: { command: 'old' }, manual: { command: 'mine' }
    } }))
    const hook = INTEGRATION_SYNC_HOOKS.find(hook => hook.id === 'cursor')!
    await hook.materialize!({
      projectRoot, paths, config: createDefaultAgentsConfig(), enabled: true,
      check: false, changed: [], warnings: [],
      generatedByIntegration: { cursor: '{"mcpServers":{}}' },
      previousGeneratedByIntegration: { cursor: JSON.stringify({ mcpServers: {
        stale: { command: 'old' }, manual: { command: 'different' }
      } }) }
    })
    expect(JSON.parse(await readFile(paths.cursorMcp, 'utf8')).mcpServers).toEqual({
      manual: { command: 'mine' }
    })
  })

})
