import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

describe('copilot cli sync', () => {
  it('materializes project .mcp.json with Copilot CLI mcpServers shape', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-copilot-cli-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['copilot_cli']
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const materialized = JSON.parse(await readFile(path.join(projectRoot, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, { type?: string; command?: string; tools?: string[] }>
    }
    expect(materialized.mcpServers?.filesystem?.type).toBe('stdio')
    expect(materialized.mcpServers?.filesystem?.command).toBe('npx')
    expect(materialized.mcpServers?.filesystem?.tools).toEqual(['*'])

    const generated = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'copilot.cli.mcp.json'), 'utf8'),
    ) as { mcpServers?: Record<string, unknown> }
    expect(Object.keys(generated.mcpServers ?? {})).toContain('filesystem')

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toHaveLength(0)
  })
})
