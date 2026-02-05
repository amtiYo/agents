import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { performSync } from '../src/core/sync.js'

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
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    expect(await exists(path.join(projectRoot, '.agents', 'agents.json'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'local.json'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'skills'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.codex', 'config.toml'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.vscode', 'settings.json'))).toBe(true)

    const projectConfig = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'))
    expect(projectConfig.schemaVersion).toBe(3)
    expect(projectConfig.syncMode).toBe('source-only')
    expect(projectConfig.integrations.enabled).toContain('codex')
    expect(projectConfig.workspace.vscode.hideGenerated).toBe(true)

    expect(Object.keys(projectConfig.mcp.servers).sort()).toEqual(['fetch', 'filesystem', 'git'])
    expect(await exists(path.join(projectRoot, '.agents', 'skills', 'skill-guide', 'SKILL.md'))).toBe(true)

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).toHaveLength(0)
  })
})
