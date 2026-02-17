import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousAntigravityMcpPath: string | undefined

beforeEach(() => {
  previousAntigravityMcpPath = process.env.AGENTS_ANTIGRAVITY_MCP_PATH
})

afterEach(async () => {
  if (previousAntigravityMcpPath === undefined) {
    delete process.env.AGENTS_ANTIGRAVITY_MCP_PATH
  } else {
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = previousAntigravityMcpPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('cursor + antigravity sync', () => {
  it('materializes cursor project config and antigravity global config', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    const antigravityGlobalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ag-global-'))
    tempDirs.push(projectRoot, antigravityGlobalDir)
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = path.join(antigravityGlobalDir, 'mcp.json')

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

    const antigravityGlobal = JSON.parse(
      await readFile(path.join(antigravityGlobalDir, 'mcp.json'), 'utf8'),
    ) as Record<string, unknown>
    const serverNames = Object.keys((antigravityGlobal.servers as Record<string, unknown>) ?? {})
    const mcpServerNames = Object.keys((antigravityGlobal.mcpServers as Record<string, unknown>) ?? {})
    expect(serverNames.some((name) => name.includes('filesystem'))).toBe(true)
    expect(mcpServerNames.some((name) => name.includes('filesystem'))).toBe(true)
    await expect(lstat(path.join(projectRoot, '.antigravity', 'mcp.json'))).rejects.toThrow()
    await expect(lstat(path.join(projectRoot, '.gemini', 'skills'))).resolves.toBeTruthy()
  }, 15000)
})
