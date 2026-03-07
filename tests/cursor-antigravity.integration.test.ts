import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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

    await expect(stat(path.join(antigravityGlobalDir, 'mcp.json'))).rejects.toThrow()
    const generatedAntigravity = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'antigravity.mcp.json'), 'utf8'),
    ) as Record<string, unknown>
    const generatedServerNames = Object.keys((generatedAntigravity.servers as Record<string, unknown>) ?? {})
    expect(generatedServerNames.some((name) => name.includes('filesystem'))).toBe(true)
    await expect(lstat(path.join(projectRoot, '.antigravity', 'mcp.json'))).rejects.toThrow()
    await expect(lstat(path.join(projectRoot, '.gemini', 'skills'))).resolves.toBeTruthy()
  }, 15000)

  it('removes stale antigravity global config when global sync is disabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    const antigravityGlobalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ag-global-'))
    const globalPath = path.join(antigravityGlobalDir, 'mcp.json')
    tempDirs.push(projectRoot, antigravityGlobalDir)
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = globalPath

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    config.integrations.options.antigravityGlobalSync = true
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })
    await expect(stat(globalPath)).resolves.toBeTruthy()

    const disabled = await loadAgentsConfig(projectRoot)
    disabled.integrations.options.antigravityGlobalSync = false
    await saveAgentsConfig(projectRoot, disabled)

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toContain(globalPath)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })
    await expect(stat(globalPath)).rejects.toThrow()

    const generatedAntigravity = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'antigravity.mcp.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.keys((generatedAntigravity.servers as Record<string, unknown>) ?? {})).not.toHaveLength(0)
  })
})
