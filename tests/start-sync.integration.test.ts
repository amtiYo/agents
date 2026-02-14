import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import TOML from '@iarna/toml'

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

    const configWithHttp = await loadAgentsConfig(projectRoot)
    configWithHttp.mcp.servers.remoteDocs = {
      transport: 'http',
      url: 'https://developers.openai.com/mcp',
      targets: ['codex']
    }
    await saveAgentsConfig(projectRoot, configWithHttp)
    await performSync({ projectRoot, check: false, verbose: false })

    const codexConfigText = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
    expect(codexConfigText).toContain('[mcp_servers."remoteDocs"]')
    expect(codexConfigText).toContain('url = "https://developers.openai.com/mcp"')
    expect(() => TOML.parse(codexConfigText)).not.toThrow()

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).toHaveLength(0)
  })

  it('preserves existing AGENTS.md during start even with force setup', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-preserve-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    const originalContent = '# Team Instructions\n\nDo not overwrite me.\n'
    await writeFile(path.join(projectRoot, 'AGENTS.md'), originalContent, 'utf8')

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(originalContent)
  })

  it('warns and skips overwrite when AGENTS.md is a symlink', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-symlink-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    const targetPath = path.join(projectRoot, 'TEAM.md')
    await writeFile(targetPath, '# Team Link Target\n', 'utf8')
    await symlink('TEAM.md', path.join(projectRoot, 'AGENTS.md'))

    const output = await captureStdout(async () => {
      await runStart({
        projectRoot,
        nonInteractive: true,
        yes: true
      })
    })

    const info = await lstat(path.join(projectRoot, 'AGENTS.md'))
    expect(info.isSymbolicLink()).toBe(true)
    expect(await readlink(path.join(projectRoot, 'AGENTS.md'))).toBe('TEAM.md')
    expect(output).toContain('AGENTS.md exists and is not a regular file (symlink/directory). Skipped overwrite.')
  })
})

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  ;(process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    chunks.push(chunk)
    return true
  }) as unknown as typeof process.stdout.write

  try {
    await fn()
  } finally {
    ;(process.stdout.write as unknown as typeof process.stdout.write) = originalWrite as unknown as typeof process.stdout.write
  }

  return chunks.join('')
}
