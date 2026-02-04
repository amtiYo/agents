import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousCatalogPath: string | undefined
let previousPathEnv: string | undefined
let previousCodexConfigPath: string | undefined

beforeEach(() => {
  previousCatalogPath = process.env.AGENTS_CATALOG_PATH
  previousPathEnv = process.env.PATH
  previousCodexConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
})

afterEach(async () => {
  if (previousCatalogPath === undefined) {
    delete process.env.AGENTS_CATALOG_PATH
  } else {
    process.env.AGENTS_CATALOG_PATH = previousCatalogPath
  }

  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }

  if (previousCodexConfigPath === undefined) {
    delete process.env.AGENTS_CODEX_CONFIG_PATH
  } else {
    process.env.AGENTS_CODEX_CONFIG_PATH = previousCodexConfigPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

describe('start + sync flow', () => {
  it('bootstraps project from one command and stays idempotent', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-'))
    const catalogDir = await mkdtemp(path.join(os.tmpdir(), 'agents-catalog-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, catalogDir, codexDir)

    process.env.AGENTS_CATALOG_PATH = path.join(catalogDir, 'catalog.json')
    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    expect(await exists(path.join(projectRoot, '.agents', 'project.json'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'mcp', 'selection.json'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'skills'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.codex', 'config.toml'))).toBe(true)

    const projectConfig = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'project.json'), 'utf8'))
    expect(projectConfig.schemaVersion).toBe(2)
    expect(projectConfig.syncMode).toBe('source-only')
    expect(projectConfig.enabledIntegrations).toContain('codex')
    expect(projectConfig.selectedSkillPacks).toContain('skills-starter')

    const selection = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'mcp', 'selection.json'), 'utf8'))
    expect(selection.selectedMcpServers).toEqual(['fetch', 'filesystem', 'git'])
    expect(await exists(path.join(projectRoot, '.agents', 'skills', 'skill-guide', 'SKILL.md'))).toBe(true)

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).toHaveLength(0)
  })
})
