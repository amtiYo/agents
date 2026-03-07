import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('reports warning when existing gemini settings are invalid JSON', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-validation-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['gemini']
    await saveAgentsConfig(projectRoot, config)

    const geminiPath = path.join(projectRoot, '.gemini', 'settings.json')
    await mkdir(path.dirname(geminiPath), { recursive: true })
    await writeFile(geminiPath, '{ invalid json', 'utf8')

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let result
    try {
      result = await performSync({
        projectRoot,
        check: false,
        verbose: false
      })
    } finally {
      warnSpy.mockRestore()
    }

    expect(
      result.warnings.some((warning) =>
        warning.includes('Failed to read existing Gemini config at')
        && warning.includes('starting fresh')
      )
    ).toBe(true)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
