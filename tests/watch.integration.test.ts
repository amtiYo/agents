import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { runWatch } from '../src/commands/watch.js'
import { readJson } from '../src/core/fs.js'

const tempDirs: string[] = []
let previousPathEnv: string | undefined
let previousCodexConfigPath: string | undefined

beforeEach(() => {
  previousPathEnv = process.env.PATH
  previousCodexConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
})

afterEach(async () => {
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
  it('runs a one-shot sync and applies MCP config changes', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-watch-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const configPath = path.join(projectRoot, '.agents', 'agents.json')
    const config = await readJson<Record<string, unknown>>(configPath)
    const mcp = config.mcp as { servers?: Record<string, unknown> }
    if (mcp?.servers) {
      mcp.servers = {
        filesystem: mcp.servers.filesystem
      }
    }
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

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
