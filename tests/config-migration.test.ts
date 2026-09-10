import { describe, expect, it, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createDefaultAgentsConfig,
  loadAgentsConfigDetailed,
  migrateAgentsConfig,
  persistMigratedConfig
} from '../src/core/config.js'
import { resolveFromConfigAndLocal } from '../src/core/mcp.js'
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

describe('schema migration', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

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
