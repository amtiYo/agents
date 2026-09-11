import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createDefaultAgentsConfig,
  loadAgentsConfigDetailed,
  migrateAgentsConfig,
  persistMigratedConfig,
  saveAgentsConfig
} from '../src/core/config.js'
import { loadResolvedRegistry, resolveFromConfigAndLocal } from '../src/core/mcp.js'
import { performSync } from '../src/core/sync.js'
import { runInit } from '../src/commands/init.js'
import { AGENTS_SCHEMA_VERSION } from '../src/types.js'
import type { AgentsConfig } from '../src/types.js'

const tempDirs: string[] = []

async function makeProject(config: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-migration-'))
  tempDirs.push(dir)
  await mkdir(path.join(dir, '.agents'), { recursive: true })
  await writeFile(path.join(dir, '.agents', 'agents.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return dir
}

function schemaV3Config(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    instructions: { path: 'AGENTS.md' },
    integrations: {
      enabled: ['codex', 'claude'],
      options: { cursorAutoApprove: true, antigravityGlobalSync: true }
    },
    syncMode: 'source-only',
    mcp: {
      servers: {
        filesystem: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}']
        }
      }
    },
    workspace: { vscode: { hideGenerated: true, hiddenPaths: [] } },
    lastSync: null
  }
}

// Module level, so every describe in this file gets its temp directories cleaned up.
afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('schema migration', () => {
  it('migrates a version 3 config and keeps Claude on local scope', async () => {
    const dir = await makeProject(schemaV3Config())
    const { config, migratedFrom } = await loadAgentsConfigDetailed(dir)

    expect(migratedFrom).toBe(3)
    expect(config.schemaVersion).toBe(AGENTS_SCHEMA_VERSION)
    expect(config.integrations.options.claudeScope).toBe('local')
    expect(config.integrations.options.copilotCliPath).toBe('.mcp.json')
    expect(config.mcp.servers.filesystem?.command).toBe('npx')
  })

  it('reports no migration for a current config', async () => {
    const dir = await makeProject(createDefaultAgentsConfig({ enabledIntegrations: ['codex'] }))
    const { migratedFrom, config } = await loadAgentsConfigDetailed(dir)

    expect(migratedFrom).toBeNull()
    expect(config.integrations.options.claudeScope).toBe('project')
  })

  it('rejects schema versions older than the migration floor', () => {
    const stale = { ...schemaV3Config(), schemaVersion: 2 } as unknown as AgentsConfig
    expect(() => migrateAgentsConfig(stale)).toThrow(/Unsupported agents schema version 2/)
  })

  it('rejects schema versions newer than this CLI', () => {
    const future = { ...schemaV3Config(), schemaVersion: 99 } as unknown as AgentsConfig
    expect(() => migrateAgentsConfig(future)).toThrow(/Unsupported agents schema version 99/)
  })

  it('writes a backup next to the migrated config', async () => {
    const dir = await makeProject(schemaV3Config())
    const { config, migratedFrom } = await loadAgentsConfigDetailed(dir)
    expect(migratedFrom).toBe(3)

    const backupPath = await persistMigratedConfig(dir, config, migratedFrom as number)

    const backup = JSON.parse(await readFile(backupPath, 'utf8')) as { schemaVersion: number }
    const current = JSON.parse(await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')) as {
      schemaVersion: number
    }

    expect(backup.schemaVersion).toBe(3)
    expect(current.schemaVersion).toBe(AGENTS_SCHEMA_VERSION)
  })
})

describe('profiles', () => {
  it('limits resolution to the servers named by the profile', () => {
    const resolved = resolveFromConfigAndLocal({
      projectRoot: '/tmp/project',
      servers: {
        alpha: { transport: 'stdio', command: 'alpha-server' },
        beta: { transport: 'stdio', command: 'beta-server' }
      },
      local: { mcpServers: {} },
      profile: { servers: ['beta'] }
    })

    expect(resolved.selectedServerNames).toEqual(['beta'])
    expect(resolved.serversByTarget.codex.map((server) => server.name)).toEqual(['beta'])
  })

  it('keeps every server when no profile is applied', () => {
    const resolved = resolveFromConfigAndLocal({
      projectRoot: '/tmp/project',
      servers: {
        alpha: { transport: 'stdio', command: 'alpha-server' },
        beta: { transport: 'stdio', command: 'beta-server' }
      },
      local: { mcpServers: {} }
    })

    expect(resolved.selectedServerNames).toEqual(['alpha', 'beta'])
  })
})

describe('variable expansion', () => {
  it('uses the fallback of ${VAR:-default} without warning', () => {
    delete process.env.AGENTS_TEST_MISSING_VAR
    const resolved = resolveFromConfigAndLocal({
      projectRoot: '/tmp/project',
      servers: {
        api: {
          transport: 'http',
          url: '${AGENTS_TEST_MISSING_VAR:-https://api.example.com}/mcp'
        }
      },
      local: { mcpServers: {} }
    })

    expect(resolved.serversByTarget.codex[0]?.url).toBe('https://api.example.com/mcp')
    expect(resolved.warnings).toEqual([])
  })

  it('prefers the environment value over the fallback', () => {
    process.env.AGENTS_TEST_PRESENT_VAR = 'https://real.example.com'
    try {
      const resolved = resolveFromConfigAndLocal({
        projectRoot: '/tmp/project',
        servers: {
          api: { transport: 'http', url: '${AGENTS_TEST_PRESENT_VAR:-https://api.example.com}/mcp' }
        },
        local: { mcpServers: {} }
      })

      expect(resolved.serversByTarget.codex[0]?.url).toBe('https://real.example.com/mcp')
    } finally {
      delete process.env.AGENTS_TEST_PRESENT_VAR
    }
  })

  it('still warns for a plain ${VAR} that is not set', () => {
    delete process.env.AGENTS_TEST_MISSING_VAR
    const resolved = resolveFromConfigAndLocal({
      projectRoot: '/tmp/project',
      servers: {
        api: { transport: 'http', url: '${AGENTS_TEST_MISSING_VAR}/mcp' }
      },
      local: { mcpServers: {} }
    })

    expect(resolved.warnings.join(' ')).toContain('AGENTS_TEST_MISSING_VAR')
  })
})

describe('migration during sync', () => {
  // A migrated config keeps Claude on local scope, which shells out to the claude CLI.
  // Hiding PATH keeps these tests off the developer's real ~/.claude.json.
  async function syncWithoutClis(dir: string, check: boolean) {
    const previousPath = process.env.PATH
    process.env.PATH = ''
    try {
      return await performSync({ projectRoot: dir, check, verbose: false })
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  }

  it('writes the migrated config and a backup on the first sync', async () => {
    const dir = await makeProject(schemaV3Config())

    const result = await syncWithoutClis(dir, false)

    const current = JSON.parse(await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')) as {
      schemaVersion: number
    }
    const backup = JSON.parse(
      await readFile(path.join(dir, '.agents', 'agents.json.v3.bak'), 'utf8'),
    ) as { schemaVersion: number }

    expect(current.schemaVersion).toBe(AGENTS_SCHEMA_VERSION)
    expect(backup.schemaVersion).toBe(3)
    expect(result.warnings.join(' ')).toContain('Migrated .agents/agents.json from schema 3')
  })

  it('does not write anything during a check run', async () => {
    const dir = await makeProject(schemaV3Config())

    await syncWithoutClis(dir, true)

    const current = JSON.parse(await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')) as {
      schemaVersion: number
    }
    expect(current.schemaVersion).toBe(3)
  })

  it('gives servers from a schema 3 target list to the new integrations', async () => {
    const config = schemaV3Config()
    const servers = (config.mcp as { servers: Record<string, Record<string, unknown>> }).servers
    servers.filesystem.targets = [
      'codex', 'claude', 'claude_desktop', 'gemini', 'copilot_vscode', 'copilot_cli',
      'cursor', 'antigravity', 'windsurf', 'opencode', 'junie'
    ]
    const dir = await makeProject(config)

    const resolved = await loadResolvedRegistry(dir)

    expect(resolved.serversByTarget.grok.map((server) => server.name)).toEqual(['filesystem'])
    expect(resolved.serversByTarget.amp.map((server) => server.name)).toEqual(['filesystem'])
    expect(resolved.serversByTarget.zed.map((server) => server.name)).toEqual(['filesystem'])
  })
})

describe('sync bookkeeping', () => {
  it('keeps lastSync out of the committed config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-bookkeeping-'))
    tempDirs.push(dir)
    await runInit({ projectRoot: dir, force: true })

    await performSync({ projectRoot: dir, check: false, verbose: false })
    const first = JSON.parse(await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')) as {
      lastSync: string | null
      lastSyncSourceHash: string | null
    }
    expect(first.lastSync).toBeNull()
    expect(first.lastSyncSourceHash).toBeNull()

    const state = JSON.parse(
      await readFile(path.join(dir, '.agents', 'generated', 'sync.state.json'), 'utf8'),
    ) as { lastSyncSourceHash: string }
    expect(state.lastSyncSourceHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not rewrite the config on a second sync', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-bookkeeping-'))
    tempDirs.push(dir)
    await runInit({ projectRoot: dir, force: true })

    await performSync({ projectRoot: dir, check: false, verbose: false })
    const before = await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')

    const second = await performSync({ projectRoot: dir, check: false, verbose: false })

    expect(await readFile(path.join(dir, '.agents', 'agents.json'), 'utf8')).toBe(before)
    expect(second.changed).toEqual([])
  })

  it('adopts the bookkeeping fields an older config still carries', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-bookkeeping-'))
    tempDirs.push(dir)
    await runInit({ projectRoot: dir, force: true })

    const configPath = path.join(dir, '.agents', 'agents.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    config.lastSync = '2026-01-01T00:00:00.000Z'
    config.lastSyncSourceHash = 'stale-hash'
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot: dir, check: false, verbose: false })

    const after = JSON.parse(await readFile(configPath, 'utf8')) as { lastSync: string | null }
    expect(after.lastSync).toBeNull()
  })
})

describe('legacy bookkeeping adoption', () => {
  it('keeps the old timestamp and stops reporting drift on check', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-legacy-hash-'))
    tempDirs.push(dir)
    await runInit({ projectRoot: dir, force: true })

    const configPath = path.join(dir, '.agents', 'agents.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    config.lastSync = '2026-01-01T00:00:00.000Z'
    delete config.lastSyncSourceHash
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot: dir, check: false, verbose: false })

    const state = JSON.parse(
      await readFile(path.join(dir, '.agents', 'generated', 'sync.state.json'), 'utf8'),
    ) as { lastSync: string; lastSyncSourceHash: string }
    expect(state.lastSync).toBe('2026-01-01T00:00:00.000Z')

    const drift = await performSync({ projectRoot: dir, check: true, verbose: false })
    expect(drift.changed).toEqual([])
  })

  it('backs up the previous file on any save that raises the schema version', async () => {
    const dir = await makeProject(schemaV3Config())

    // A command that edits the config without going through the migration helper.
    const { config } = await loadAgentsConfigDetailed(dir)
    config.mcp.servers.extra = { transport: 'stdio', command: 'extra-server' }
    await saveAgentsConfig(dir, config)

    const backup = JSON.parse(
      await readFile(path.join(dir, '.agents', 'agents.json.v3.bak'), 'utf8'),
    ) as { schemaVersion: number }
    expect(backup.schemaVersion).toBe(3)
  })
})
