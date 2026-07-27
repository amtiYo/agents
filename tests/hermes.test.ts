import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  mergeHermesConfig,
  normalizeHermesManagedState,
  resolveHermesConfigPath
} from '../src/core/hermes.js'

const tempDirs: string[] = []

interface HermesTestConfig {
  model?: { default?: string }
  mcp_servers: Record<string, { url?: string } | undefined>
  platform_toolsets: Record<string, string[]>
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('Hermes config integration', () => {
  it('preserves comments, unrelated settings and unmanaged MCP servers', () => {
    const source = `# operator comment
model:
  default: gpt-5
mcp_servers:
  manual:
    url: https://manual.example/mcp
  old-managed:
    url: https://old.example/mcp
platform_toolsets:
  telegram: [web, old-managed]
`

    const merged = mergeHermesConfig(source, ['old-managed'], {
      utilities: {
        enabled: true,
        url: 'https://utilities.example/mcp'
      }
    })
    const parsed = parse(merged) as HermesTestConfig

    expect(merged).toContain('# operator comment')
    expect(parsed.model.default).toBe('gpt-5')
    expect(parsed.mcp_servers.manual.url).toBe('https://manual.example/mcp')
    expect(parsed.mcp_servers['old-managed']).toBeUndefined()
    expect(parsed.mcp_servers.utilities.url).toBe('https://utilities.example/mcp')
    expect(parsed.platform_toolsets.telegram).toEqual(['web', 'utilities'])
  })

  it('honors no_mcp and removes stale managed entries without adding replacements', () => {
    const source = `mcp_servers:
  stale:
    command: stale-server
platform_toolsets:
  locked: [terminal, no_mcp, stale]
`

    const merged = mergeHermesConfig(source, ['stale'], {
      utilities: { enabled: true, url: 'https://utilities.example/mcp' }
    })
    const parsed = parse(merged) as HermesTestConfig

    expect(parsed.mcp_servers.stale).toBeUndefined()
    expect(parsed.mcp_servers.utilities).toBeDefined()
    expect(parsed.platform_toolsets.locked).toEqual(['terminal', 'no_mcp'])
  })

  it('uses HERMES_HOME by default and resolves one explicit workspace profile', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'agents-hermes-home-'))
    const activeHome = path.join(home, 'active-hermes')
    tempDirs.push(home)
    await mkdir(activeHome, { recursive: true })

    const active = resolveHermesConfigPath({
      profile: null,
      env: { HERMES_HOME: activeHome },
      homeDir: home
    })
    const named = resolveHermesConfigPath({
      profile: 'home-lab',
      env: { HERMES_HOME: activeHome },
      homeDir: home
    })

    expect(active).toBe(path.join(activeHome, 'config.yaml'))
    expect(named).toBe(path.join(home, '.hermes', 'profiles', 'home-lab', 'config.yaml'))
  })

  it('accepts an explicit config path override', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'agents-hermes-home-'))
    tempDirs.push(home)
    const target = path.join(home, 'one.yaml')

    const configPath = resolveHermesConfigPath({
      profile: 'ignored-by-override',
      env: { AGENTS_HERMES_CONFIG_PATH: target },
      homeDir: home
    })

    expect(configPath).toBe(target)
  })

  it('rejects an unsafe profile name', () => {
    expect(() => resolveHermesConfigPath({
      profile: '../other-profile',
      env: {},
      homeDir: '/tmp/home'
    })).toThrow(/Invalid Hermes profile/)
  })

  it('normalizes managed state defensively', () => {
    expect(normalizeHermesManagedState({
      configs: {
        '/tmp/config.yaml': ['utilities', 'utilities', 42],
        invalid: 'utilities'
      }
    })).toEqual({
      configs: {
        '/tmp/config.yaml': ['utilities']
      }
    })
    expect(normalizeHermesManagedState(null)).toEqual({ configs: {} })
  })
})
