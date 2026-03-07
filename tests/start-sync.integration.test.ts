import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { runReset } from '../src/commands/reset.js'
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
    expect(typeof projectConfig.lastSync).toBe('string')

    expect(Object.keys(projectConfig.mcp.servers).sort()).toEqual(['fetch', 'filesystem', 'git'])
    expect(await exists(path.join(projectRoot, '.agents', 'skills', 'skill-guide', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'skills', 'docs-research', 'SKILL.md'))).toBe(true)
    expect(await exists(path.join(projectRoot, '.agents', 'skills', 'mcp-troubleshooting', 'SKILL.md'))).toBe(true)
    expect(await readFile(path.join(projectRoot, '.gitignore'), 'utf8')).toContain('CLAUDE.md')
    const firstLastSync = projectConfig.lastSync

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

    const configAfterDriftSync = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as { lastSync: string | null }
    expect(typeof configAfterDriftSync.lastSync).toBe('string')
    expect(configAfterDriftSync.lastSync).not.toBe(firstLastSync)

    await waitForTimestampTick()
    await performSync({ projectRoot, check: false, verbose: false })

    const configAfterNoopSync = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as { lastSync: string | null }
    expect(configAfterNoopSync.lastSync).toBe(configAfterDriftSync.lastSync)

    await writeFile(path.join(projectRoot, '.codex', 'config.toml'), '', 'utf8')
    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).toContain('.codex/config.toml')

    const configAfterCheck = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as { lastSync: string | null }
    expect(configAfterCheck.lastSync).toBe(configAfterNoopSync.lastSync)
  })

  it('keeps lastSync stable after safe reset when sources did not change', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-reset-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const configBeforeReset = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as { lastSync: string | null; lastSyncSourceHash?: string | null }

    expect(typeof configBeforeReset.lastSync).toBe('string')
    expect(typeof configBeforeReset.lastSyncSourceHash).toBe('string')

    await runReset({ projectRoot, localOnly: false, hard: false })
    await waitForTimestampTick()
    await performSync({ projectRoot, check: false, verbose: false })

    const configAfterResetSync = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as { lastSync: string | null; lastSyncSourceHash?: string | null }

    expect(configAfterResetSync.lastSync).toBe(configBeforeReset.lastSync)
    expect(configAfterResetSync.lastSyncSourceHash).toBe(configBeforeReset.lastSyncSourceHash)
  })

  it('backfills source hash for legacy configs without bumping lastSync', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-legacy-'))
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
    const legacyConfig = JSON.parse(await readFile(configPath, 'utf8')) as {
      lastSync: string | null
      lastSyncSourceHash?: string | null
    }

    const lastSyncBeforeBackfill = legacyConfig.lastSync
    delete legacyConfig.lastSyncSourceHash
    await writeFile(configPath, `${JSON.stringify(legacyConfig, null, 2)}\n`, 'utf8')

    await runReset({ projectRoot, localOnly: false, hard: false })
    await waitForTimestampTick()
    await performSync({ projectRoot, check: false, verbose: false })

    const configAfterBackfill = JSON.parse(await readFile(configPath, 'utf8')) as {
      lastSync: string | null
      lastSyncSourceHash?: string | null
    }

    expect(configAfterBackfill.lastSync).toBe(lastSyncBeforeBackfill)
    expect(typeof configAfterBackfill.lastSyncSourceHash).toBe('string')
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

  it('preserves existing agents config on repeated start by default', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-preserve-config-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['cursor', 'claude']
    config.mcp.servers.teamDocs = {
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['cursor', 'claude']
    }
    await saveAgentsConfig(projectRoot, config)

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const after = await loadAgentsConfig(projectRoot)
    expect(after.integrations.enabled).toEqual(['cursor', 'claude'])
    expect(after.mcp.servers.teamDocs).toEqual({
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['cursor', 'claude']
    })
  })

  it('reinitializes existing agents config when start uses --reinit', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-reinit-config-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['cursor']
    config.mcp.servers.teamDocs = {
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['cursor']
    }
    await saveAgentsConfig(projectRoot, config)

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true,
      reinit: true
    })

    const after = await loadAgentsConfig(projectRoot)
    expect(after.integrations.enabled).toEqual(['codex'])
    expect(after.mcp.servers.teamDocs).toBeUndefined()
    expect(Object.keys(after.mcp.servers).sort()).toEqual(['fetch', 'filesystem', 'git'])
  })

  it('does not fail start when Codex trust config is invalid TOML', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-codex-invalid-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-invalid-'))
    tempDirs.push(projectRoot, codexDir)

    const brokenCodexConfig = path.join(codexDir, 'config.toml')
    await writeFile(brokenCodexConfig, '[[projects]\n', 'utf8')

    process.env.AGENTS_CODEX_CONFIG_PATH = brokenCodexConfig
    process.env.PATH = '/dev/null'

    const output = await captureStdout(async () => {
      await runStart({
        projectRoot,
        nonInteractive: true,
        yes: true
      })
    })

    expect(await exists(path.join(projectRoot, '.agents', 'agents.json'))).toBe(true)
    expect(output).toContain('Codex trust setup skipped')
  })

  it('does not modify README/CONTRIBUTING by default in non-interactive mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-docs-default-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    const readmePath = path.join(projectRoot, 'README.md')
    const contributingPath = path.join(projectRoot, 'CONTRIBUTING.md')
    await writeFile(readmePath, '# Demo Project\n', 'utf8')
    await writeFile(contributingPath, '# Contributing\n', 'utf8')

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true
    })

    const readme = await readFile(readmePath, 'utf8')
    const contributing = await readFile(contributingPath, 'utf8')
    expect(readme).not.toContain('<!-- agents:project-docs:start -->')
    expect(contributing).not.toContain('<!-- agents:project-docs:start -->')
  })

  it('injects docs guide when start uses --inject-docs in non-interactive mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-docs-flag-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    const readmePath = path.join(projectRoot, 'README.md')
    const contributingPath = path.join(projectRoot, 'CONTRIBUTING.md')
    await writeFile(readmePath, '# Demo Project\n', 'utf8')
    await writeFile(contributingPath, '# Contributing\n', 'utf8')

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true,
      injectDocs: true
    })

    const readme = await readFile(readmePath, 'utf8')
    const contributing = await readFile(contributingPath, 'utf8')
    expect(readme).toContain('<!-- agents:project-docs:start -->')
    expect(contributing).toContain('<!-- agents:project-docs:start -->')
  })

  it('injects README only and does not create CONTRIBUTING when missing', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-docs-missing-contrib-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-'))
    tempDirs.push(projectRoot, codexDir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')
    process.env.PATH = '/dev/null'

    const readmePath = path.join(projectRoot, 'README.md')
    await writeFile(readmePath, '# Demo Project\n', 'utf8')

    await runStart({
      projectRoot,
      nonInteractive: true,
      yes: true,
      injectDocs: true
    })

    const readme = await readFile(readmePath, 'utf8')
    expect(readme).toContain('<!-- agents:project-docs:start -->')
    expect(await exists(path.join(projectRoot, 'CONTRIBUTING.md'))).toBe(false)
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

async function waitForTimestampTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}
