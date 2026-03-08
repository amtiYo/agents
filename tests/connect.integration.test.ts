import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { getConnectableIntegrations, runConnect } from '../src/commands/connect.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('connect command', () => {
  it('adds integrations instead of replacing existing enabled set', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-connect-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, config)

    await runConnect({
      projectRoot,
      llm: 'cursor',
      interactive: false,
      verbose: false
    })

    const updated = await loadAgentsConfig(projectRoot)
    expect(updated.integrations.enabled).toContain('codex')
    expect(updated.integrations.enabled).toContain('cursor')
  }, 20_000)

  it('interactive mode only offers currently disabled integrations', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-connect-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, config)

    const options = getConnectableIntegrations(['codex']).map((item) => item.value)
    expect(options).not.toContain('codex')
    expect(options).toContain('cursor')

    let promptCurrent: string[] = []

    await runConnect({
      projectRoot,
      interactive: true,
      verbose: false,
      promptSelection: async (current) => {
        promptCurrent = [...current]
        return ['cursor']
      }
    })

    expect(promptCurrent).toEqual(['codex'])

    const updated = await loadAgentsConfig(projectRoot)
    expect(updated.integrations.enabled).toContain('codex')
    expect(updated.integrations.enabled).toContain('cursor')
  }, 20_000)
})
