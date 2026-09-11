import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runProfileRemove, runProfileSet, runProfileUse } from '../src/commands/profile.js'
import { runMcpBudget } from '../src/commands/mcp-budget.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'
import { estimateTokens, probeServerTools } from '../src/core/mcpProbe.js'

const tempDirs: string[] = []

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-profile-'))
  tempDirs.push(projectRoot)
  await runInit({ projectRoot, force: true })

  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = ['cursor']
  config.mcp.servers = {
    alpha: { transport: 'stdio', command: 'alpha-server' },
    beta: { transport: 'stdio', command: 'beta-server' },
    gamma: { transport: 'http', url: 'https://mcp.example.com/mcp' }
  }
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

async function readCursorServers(projectRoot: string): Promise<string[]> {
  const paths = getProjectPaths(projectRoot)
  const payload = JSON.parse(await readFile(paths.cursorMcp, 'utf8')) as {
    mcpServers: Record<string, unknown>
  }
  return Object.keys(payload.mcpServers).sort()
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('profiles', () => {
  it('limits a sync to the servers of the active profile', async () => {
    const projectRoot = await makeProject()

    await runProfileSet({
      projectRoot,
      name: 'ci',
      servers: ['alpha', 'gamma'],
      description: 'Minimal set for pipelines',
      json: true
    })
    await runProfileUse({ projectRoot, name: 'ci', sync: true, json: true })

    expect(await readCursorServers(projectRoot)).toEqual(['alpha', 'gamma'])

    const config = await loadAgentsConfig(projectRoot)
    expect(config.activeProfile).toBe('ci')
    expect(config.profiles?.ci?.description).toBe('Minimal set for pipelines')
  })

  it('restores every server when the profile is cleared', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })
    await runProfileUse({ projectRoot, name: 'ci', sync: true, json: true })
    expect(await readCursorServers(projectRoot)).toEqual(['alpha'])

    await runProfileUse({ projectRoot, name: null, sync: true, json: true })

    expect(await readCursorServers(projectRoot)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('applies a one-off profile through sync without changing the active one', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['beta'], json: true })

    await performSync({ projectRoot, check: false, verbose: false, profile: 'ci' })

    expect(await readCursorServers(projectRoot)).toEqual(['beta'])
    const config = await loadAgentsConfig(projectRoot)
    expect(config.activeProfile).toBeNull()
  })

  it('rejects a profile that names an unknown server', async () => {
    const projectRoot = await makeProject()

    await expect(
      runProfileSet({ projectRoot, name: 'bad', servers: ['nope'], json: true }),
    ).rejects.toThrow(/Unknown MCP server/)
  })

  it('rejects activating a profile that does not exist', async () => {
    const projectRoot = await makeProject()

    await expect(
      runProfileUse({ projectRoot, name: 'missing', sync: false, json: true }),
    ).rejects.toThrow(/not defined/)
  })

  it('clears the active profile when it is removed', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })
    await runProfileUse({ projectRoot, name: 'ci', sync: false, json: true })

    await runProfileRemove({ projectRoot, name: 'ci', json: true })

    const config = await loadAgentsConfig(projectRoot)
    expect(config.activeProfile).toBeNull()
    expect(config.profiles).toBeUndefined()
  })

  it('fails on an explicit profile that does not exist instead of syncing everything', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })

    await expect(
      performSync({ projectRoot, check: false, verbose: false, profile: 'ghost' }),
    ).rejects.toThrow(/Profile "ghost" is not defined/)
  })

  it('warns and keeps every server when the active profile vanished from the file', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })
    await runProfileUse({ projectRoot, name: 'ci', sync: false, json: true })

    // Simulate a teammate deleting the profile while it is still the active one.
    const config = await loadAgentsConfig(projectRoot)
    const previousActive = config.activeProfile
    delete config.profiles
    config.activeProfile = previousActive
    await saveAgentsConfig(projectRoot, config)

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('is not defined')
    expect(await readCursorServers(projectRoot)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('rejects a non-numeric timeout', async () => {
    const projectRoot = await makeProject()

    await expect(
      runMcpBudget({ projectRoot, timeoutMs: Number.NaN, json: true, verbose: false }),
    ).rejects.toThrow(/Invalid --timeout/)
  })
})

describe('context budget probe', () => {
  it('estimates tokens from characters', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(4)).toBe(1)
    expect(estimateTokens(5)).toBe(2)
  })

  it('skips servers that still contain placeholders instead of starting them', async () => {
    const result = await probeServerTools(
      {
        name: 'needs-secret',
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer ${MISSING_TOKEN}' }
      },
      1000,
    )

    expect(result.skipped).toBe('unresolved ${VAR} placeholder')
    expect(result.ok).toBe(false)
  })

  it('reports a stdio server that cannot start', async () => {
    const result = await probeServerTools(
      { name: 'broken', transport: 'stdio', command: 'agents-test-missing-binary', args: [] },
      3000,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('times out instead of hanging on a server that never answers', async () => {
    const result = await probeServerTools(
      { name: 'silent', transport: 'stdio', command: 'cat', args: [] },
      600,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('timed out')
  })
})

describe('profile edge cases', () => {
  it('keeps a malformed profile in the file instead of dropping it on the next save', async () => {
    const projectRoot = await makeProject()
    const configPath = path.join(projectRoot, '.agents', 'agents.json')

    const raw = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    raw.profiles = { broken: { servers: 'alpha' }, ok: { servers: ['alpha'] } }
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')

    await runProfileSet({ projectRoot, name: 'extra', servers: ['beta'], json: true })

    const after = JSON.parse(await readFile(configPath, 'utf8')) as {
      profiles: Record<string, { servers: string[] }>
    }
    expect(Object.keys(after.profiles).sort()).toEqual(['broken', 'extra', 'ok'])
    expect(after.profiles.broken?.servers).toEqual([])
  })

  it('re-syncs when the removed profile was the active one', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })
    await runProfileUse({ projectRoot, name: 'ci', sync: true, json: true })
    expect(await readCursorServers(projectRoot)).toEqual(['alpha'])

    await runProfileRemove({ projectRoot, name: 'ci', json: true })

    expect(await readCursorServers(projectRoot)).toEqual(['alpha', 'beta', 'gamma'])
  })
})

describe('replacing the active profile', () => {
  it('re-syncs so tool configs follow the new set', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })
    await runProfileUse({ projectRoot, name: 'ci', sync: true, json: true })
    expect(await readCursorServers(projectRoot)).toEqual(['alpha'])

    await runProfileSet({ projectRoot, name: 'ci', servers: ['beta', 'gamma'], json: true })

    expect(await readCursorServers(projectRoot)).toEqual(['beta', 'gamma'])
  })

  it('leaves configs alone when the replaced profile is not active', async () => {
    const projectRoot = await makeProject()
    await runProfileSet({ projectRoot, name: 'ci', servers: ['alpha'], json: true })

    await runProfileSet({ projectRoot, name: 'ci', servers: ['beta'], json: true })

    const config = await loadAgentsConfig(projectRoot)
    expect(config.activeProfile).toBeNull()
    expect(config.profiles?.ci?.servers).toEqual(['beta'])
  })
})
