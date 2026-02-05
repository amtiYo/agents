import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('sync validation', () => {
  it('fails fast when existing config contains invalid env key', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-validation-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex']
    config.mcp.servers.invalid = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {
        'BAD KEY': '123'
      }
    }
    await saveAgentsConfig(projectRoot, config)

    await expect(
      performSync({
        projectRoot,
        check: false,
        verbose: false
      }),
    ).rejects.toThrow(/Invalid environment variable key "BAD KEY" in server "invalid"/)
  })
})
