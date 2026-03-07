import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousPathEnv: string | undefined

afterEach(async () => {
  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }
  previousPathEnv = undefined

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('claude sync idempotency', () => {
  it('does not report claude-local-scope drift when claude CLI is missing', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-sync-missing-cli-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    config.mcp.servers.docs = {
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['claude']
    }
    await saveAgentsConfig(projectRoot, config)

    previousPathEnv = process.env.PATH
    process.env.PATH = ''

    const first = await performSync({
      projectRoot,
      check: false,
      verbose: false
    })
    expect(first.changed).not.toContain('claude-local-scope')
    expect(first.warnings.join(' ')).toContain('Claude CLI not found; skipped Claude MCP sync.')

    const second = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(second.changed).not.toContain('claude-local-scope')
    expect(second.warnings.join(' ')).toContain('Claude CLI not found; skipped Claude MCP sync.')
  })
})
