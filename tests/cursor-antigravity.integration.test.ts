import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadProjectConfig, saveProjectConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousCatalogPath: string | undefined
let previousAntigravityPath: string | undefined

beforeEach(() => {
  previousCatalogPath = process.env.AGENTS_CATALOG_PATH
  previousAntigravityPath = process.env.AGENTS_ANTIGRAVITY_MCP_PATH
})

afterEach(async () => {
  if (previousCatalogPath === undefined) {
    delete process.env.AGENTS_CATALOG_PATH
  } else {
    process.env.AGENTS_CATALOG_PATH = previousCatalogPath
  }

  if (previousAntigravityPath === undefined) {
    delete process.env.AGENTS_ANTIGRAVITY_MCP_PATH
  } else {
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = previousAntigravityPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('cursor + antigravity sync', () => {
  it('materializes cursor project files and managed antigravity global config', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    const catalogDir = await mkdtemp(path.join(os.tmpdir(), 'agents-catalog-'))
    const antigravityDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ag-'))
    tempDirs.push(projectRoot, catalogDir, antigravityDir)

    process.env.AGENTS_CATALOG_PATH = path.join(catalogDir, 'catalog.json')
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = path.join(antigravityDir, 'mcp.json')

    await runInit({ projectRoot, force: true })

    const config = await loadProjectConfig(projectRoot)
    config.enabledIntegrations = ['cursor', 'antigravity']
    config.integrationOptions.cursorAutoApprove = false
    config.integrationOptions.antigravityGlobalSync = true
    await saveProjectConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const cursorMcp = JSON.parse(await readFile(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys((cursorMcp.mcpServers as Record<string, unknown>) ?? {})).toContain('filesystem')

    await expect(lstat(path.join(projectRoot, '.antigravity', 'mcp.json'))).rejects.toThrow()

    const antigravityGlobal = JSON.parse(
      await readFile(path.join(antigravityDir, 'mcp.json'), 'utf8'),
    ) as Record<string, unknown>
    const serverNames = Object.keys((antigravityGlobal.servers as Record<string, unknown>) ?? {})
    expect(serverNames.some((name) => name.includes('filesystem'))).toBe(true)
  })
})
