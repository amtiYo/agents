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

describe('cursor + antigravity sync', () => {
  it('materializes cursor and antigravity project files', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['cursor', 'antigravity']
    config.integrations.options.cursorAutoApprove = false
    config.integrations.options.antigravityGlobalSync = false
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const cursorMcp = JSON.parse(await readFile(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys((cursorMcp.mcpServers as Record<string, unknown>) ?? {})).toContain('filesystem')

    const antigravityProject = JSON.parse(
      await readFile(path.join(projectRoot, '.antigravity', 'mcp.json'), 'utf8'),
    ) as Record<string, unknown>
    const serverNames = Object.keys((antigravityProject.servers as Record<string, unknown>) ?? {})
    const mcpServerNames = Object.keys((antigravityProject.mcpServers as Record<string, unknown>) ?? {})
    expect(serverNames.some((name) => name.includes('filesystem'))).toBe(true)
    expect(mcpServerNames.some((name) => name.includes('filesystem'))).toBe(true)
  })
})
