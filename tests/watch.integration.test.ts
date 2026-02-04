import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { runWatch } from '../src/commands/watch.js'

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

describe('watch command', () => {
  it('runs a one-shot sync and applies MCP selection changes', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-'))
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

    await writeFile(
      path.join(projectRoot, '.agents', 'mcp', 'selection.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          preset: 'minimal',
          selectedMcpServers: ['filesystem']
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )

    await runWatch({
      projectRoot,
      intervalMs: 100,
      once: true,
      quiet: true
    })

    const codexConfig = await readFile(path.join(projectRoot, '.agents', 'generated', 'codex.config.toml'), 'utf8')
    expect(codexConfig).toContain('server-filesystem')
    expect(codexConfig).not.toContain('mcp-server-git')
  })
})
