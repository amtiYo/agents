import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { runInit } from '../src/commands/init.js'
import { runReset } from '../src/commands/reset.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'
import { pathExists } from '../src/core/fs.js'
import type { IntegrationName } from '../src/types.js'

const NEW_PROVIDERS: IntegrationName[] = ['grok', 'amp', 'droid', 'kilo', 'devin', 'zed', 'goose']

const tempDirs: string[] = []
let previousHomeDir: string | undefined
let previousXdgConfigHome: string | undefined

async function setupProject(integrations: IntegrationName[]): Promise<string> {
  const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
  tempDirs.push(fakeHome)
  process.env.AGENTS_HOME_DIR = fakeHome
  process.env.XDG_CONFIG_HOME = path.join(fakeHome, '.config')

  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-providers-'))
  tempDirs.push(projectRoot)

  await runInit({ projectRoot, force: true })

  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = integrations
  config.mcp.servers = {
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
      env: { LOG_LEVEL: 'error' },
      timeout: 30000,
      connectTimeout: 5000
    },
    remote: {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer token-value' },
      bearerTokenEnvVar: 'EXAMPLE_TOKEN',
      disabledTools: ['danger']
    }
  }
  await saveAgentsConfig(projectRoot, config)

  await performSync({ projectRoot, check: false, verbose: false })
  return projectRoot
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

beforeEach(() => {
  previousHomeDir = process.env.AGENTS_HOME_DIR
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME
})

afterEach(async () => {
  if (previousHomeDir === undefined) delete process.env.AGENTS_HOME_DIR
  else process.env.AGENTS_HOME_DIR = previousHomeDir

  if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = previousXdgConfigHome

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('new provider sync', () => {
  it('writes Grok TOML with a headers table and sse type', async () => {
    const projectRoot = await setupProject(['grok'])
    const paths = getProjectPaths(projectRoot)

    const content = await readFile(paths.grokConfig, 'utf8')
    expect(content).toContain('[mcp_servers."local"]')
    expect(content).toContain('command = "npx"')
    expect(content).toContain('[mcp_servers."remote".headers]')
    expect(content).not.toContain('http_headers')
    expect(content).not.toContain('autoApprove')
    expect(content).toContain('bearer_token_env_var = "EXAMPLE_TOKEN"')
    expect(content).toContain('tool_timeout_sec = 30')
    expect(content).toContain('startup_timeout_sec = 5')
  })

  it('writes Amp settings under amp.mcpServers and keeps unrelated keys', async () => {
    const projectRoot = await setupProject(['amp'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, unknown>>(paths.ampSettings)
    const servers = settings['amp.mcpServers'] as Record<string, Record<string, unknown>>
    expect(Object.keys(servers).sort()).toEqual(['local', 'remote'])
    expect(servers.local?.command).toBe('npx')
    expect(servers.remote?.url).toBe('https://mcp.example.com/mcp')
  })

  it('preserves user settings already present in the Amp file', async () => {
    const projectRoot = await setupProject(['amp'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, unknown>>(paths.ampSettings)
    settings['amp.notifications.enabled'] = true
    await writeFile(paths.ampSettings, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<Record<string, unknown>>(paths.ampSettings)
    expect(after['amp.notifications.enabled']).toBe(true)
    expect(Object.keys(after['amp.mcpServers'] as Record<string, unknown>)).toHaveLength(2)
  })

  it('writes Droid mcp.json with typed entries, timeouts and disabled tools', async () => {
    const projectRoot = await setupProject(['droid'])
    const paths = getProjectPaths(projectRoot)

    const payload = await readJsonFile<{ mcpServers: Record<string, Record<string, unknown>> }>(paths.droidMcp)
    expect(payload.mcpServers.local?.type).toBe('stdio')
    expect(payload.mcpServers.local?.timeout).toBe(30000)
    expect(payload.mcpServers.local?.connectTimeout).toBe(5000)
    expect(payload.mcpServers.remote?.type).toBe('http')
    expect(payload.mcpServers.remote?.disabledTools).toEqual(['danger'])
  })

  it('writes Kilo JSONC with local and remote entries', async () => {
    const projectRoot = await setupProject(['kilo'])
    const paths = getProjectPaths(projectRoot)

    const raw = await readFile(paths.kiloConfig, 'utf8')
    const parsed = JSON.parse(raw) as { mcp: Record<string, Record<string, unknown>> }
    expect(parsed.mcp.local?.type).toBe('local')
    expect(parsed.mcp.local?.command).toEqual(['npx', '-y', '@modelcontextprotocol/server-filesystem', projectRoot])
    expect(parsed.mcp.remote?.type).toBe('remote')
    expect(parsed.mcp.remote?.url).toBe('https://mcp.example.com/mcp')
  })

  it('keeps comments in an existing Kilo JSONC file', async () => {
    const projectRoot = await setupProject(['kilo'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.kiloConfig,
      '{\n  // keep me\n  "model": "sonnet",\n  "mcp": {}\n}\n',
      'utf8',
    )
    await performSync({ projectRoot, check: false, verbose: false })

    const raw = await readFile(paths.kiloConfig, 'utf8')
    expect(raw).toContain('// keep me')
    expect(raw).toContain('"model": "sonnet"')
    expect(raw).toContain('"local"')
  })

  it('writes Devin mcp_config.json', async () => {
    const projectRoot = await setupProject(['devin'])
    const paths = getProjectPaths(projectRoot)

    const payload = await readJsonFile<{ mcpServers: Record<string, Record<string, unknown>> }>(paths.devinMcp)
    expect(payload.mcpServers.local?.command).toBe('npx')
    expect(payload.mcpServers.remote?.url).toBe('https://mcp.example.com/mcp')
  })

  it('writes Zed context_servers and keeps other editor settings', async () => {
    const projectRoot = await setupProject(['zed'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    const servers = settings.context_servers as Record<string, Record<string, unknown>>
    expect(servers.local?.command).toBe('npx')
    expect(servers.local?.source).toBe('custom')

    settings.theme = 'One Dark'
    await writeFile(paths.zedSettings, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    expect(after.theme).toBe('One Dark')
  })

  it('writes Goose extensions as env_keys and preserves provider settings', async () => {
    const projectRoot = await setupProject(['goose'])
    const paths = getProjectPaths(projectRoot)

    const doc = YAML.parse(await readFile(paths.gooseConfig, 'utf8')) as {
      extensions: Record<string, Record<string, unknown>>
    }
    expect(doc.extensions.local?.cmd).toBe('npx')
    expect(doc.extensions.local?.env_keys).toEqual(['LOG_LEVEL'])
    expect(doc.extensions.local?.type).toBe('stdio')
    expect(doc.extensions.remote?.type).toBe('streamable_http')
    expect(doc.extensions.remote?.uri).toBe('https://mcp.example.com/mcp')

    await writeFile(
      paths.gooseConfig,
      `GOOSE_PROVIDER: anthropic\n${await readFile(paths.gooseConfig, 'utf8')}`,
      'utf8',
    )
    await performSync({ projectRoot, check: false, verbose: false })

    const after = YAML.parse(await readFile(paths.gooseConfig, 'utf8')) as { GOOSE_PROVIDER?: string }
    expect(after.GOOSE_PROVIDER).toBe('anthropic')
  })

  it('never leaks env values into the Goose config', async () => {
    const projectRoot = await setupProject(['goose'])
    const paths = getProjectPaths(projectRoot)

    const raw = await readFile(paths.gooseConfig, 'utf8')
    expect(raw).toContain('LOG_LEVEL')
    expect(raw).not.toContain('error')
  })

  it('syncs every new provider in one run and reports drift as clean', async () => {
    const projectRoot = await setupProject(NEW_PROVIDERS)
    const paths = getProjectPaths(projectRoot)

    for (const file of [
      paths.grokConfig,
      paths.ampSettings,
      paths.droidMcp,
      paths.kiloConfig,
      paths.devinMcp,
      paths.zedSettings,
      paths.gooseConfig
    ]) {
      expect(await pathExists(file)).toBe(true)
    }

    const drift = await performSync({ projectRoot, check: true, verbose: false })
    expect(drift.changed).toEqual([])
  })

  it('removes managed entries on reset but keeps user settings', async () => {
    const projectRoot = await setupProject(['amp', 'zed', 'grok', 'droid'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    settings.theme = 'One Dark'
    await writeFile(paths.zedSettings, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

    await runReset({ projectRoot, localOnly: false, hard: false })

    const afterZed = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    expect(afterZed.theme).toBe('One Dark')
    expect(afterZed.context_servers ?? {}).toEqual({})

    expect(await pathExists(paths.droidMcp)).toBe(false)
    expect(await pathExists(paths.grokConfig)).toBe(false)
  })
})

describe('warning scope', () => {
  it('does not warn about integrations that are not enabled', async () => {
    const projectRoot = await setupProject(['cursor'])

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).not.toContain('Goose')
    expect(result.warnings.join(' ')).not.toContain('Claude Desktop')
  })

  it('still warns for an integration that is enabled', async () => {
    const projectRoot = await setupProject(['goose'])

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('Goose reads secrets from the environment')
  })
})

describe('shared config safety', () => {
  it('keeps servers a user added to the Droid config', async () => {
    const projectRoot = await setupProject(['droid'])
    const paths = getProjectPaths(projectRoot)

    const payload = await readJsonFile<{ mcpServers: Record<string, unknown> }>(paths.droidMcp)
    payload.mcpServers.handwritten = { type: 'stdio', command: 'mine' }
    await writeFile(paths.droidMcp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<{ mcpServers: Record<string, unknown> }>(paths.droidMcp)
    expect(Object.keys(after.mcpServers).sort()).toEqual(['handwritten', 'local', 'remote'])
  })

  it('removes only its own entries when the integration is disabled', async () => {
    const projectRoot = await setupProject(['droid'])
    const paths = getProjectPaths(projectRoot)

    const payload = await readJsonFile<{ mcpServers: Record<string, unknown> }>(paths.droidMcp)
    payload.mcpServers.handwritten = { type: 'stdio', command: 'mine' }
    await writeFile(paths.droidMcp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<{ mcpServers: Record<string, unknown> }>(paths.droidMcp)
    expect(Object.keys(after.mcpServers)).toEqual(['handwritten'])
  })

  it('syncs a Zed settings file that contains comments', async () => {
    const projectRoot = await setupProject(['zed'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.zedSettings,
      '{\n  // Zed ships comments in settings.json\n  "theme": "One Dark",\n  "context_servers": {}\n}\n',
      'utf8',
    )

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).not.toContain('skipped Zed sync')
    const raw = await readFile(paths.zedSettings, 'utf8')
    expect(raw).toContain('// Zed ships comments')
    expect(raw).toContain('"local"')
  })

  it('keeps context servers a user added to Zed settings', async () => {
    const projectRoot = await setupProject(['zed'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, Record<string, unknown>>>(paths.zedSettings)
    settings.context_servers.mine = { source: 'custom', command: 'my-server' }
    await writeFile(paths.zedSettings, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<Record<string, Record<string, unknown>>>(paths.zedSettings)
    expect(Object.keys(after.context_servers).sort()).toEqual(['local', 'mine', 'remote'])
  })

  it('removes Goose extensions on reset but keeps other settings', async () => {
    const projectRoot = await setupProject(['goose'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.gooseConfig,
      `GOOSE_PROVIDER: anthropic\n${await readFile(paths.gooseConfig, 'utf8')}`,
      'utf8',
    )
    await performSync({ projectRoot, check: false, verbose: false })

    await runReset({ projectRoot, localOnly: false, hard: false })

    const after = YAML.parse(await readFile(paths.gooseConfig, 'utf8')) as {
      GOOSE_PROVIDER?: string
      extensions?: Record<string, unknown>
    }
    expect(after.GOOSE_PROVIDER).toBe('anthropic')
    expect(after.extensions ?? {}).toEqual({})
  })

  it('removes Kilo entries on reset even when the file has comments', async () => {
    const projectRoot = await setupProject(['kilo'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.kiloConfig,
      '{\n  // user comment\n  "model": "sonnet",\n  "mcp": {}\n}\n',
      'utf8',
    )
    await performSync({ projectRoot, check: false, verbose: false })

    await runReset({ projectRoot, localOnly: false, hard: false })

    const raw = await readFile(paths.kiloConfig, 'utf8')
    expect(raw).toContain('"model": "sonnet"')
    expect(raw).not.toContain('"local"')
  })
})

describe('disabling an integration', () => {
  it('removes the managed TOML block and deletes a file that held nothing else', async () => {
    const projectRoot = await setupProject(['grok'])
    const paths = getProjectPaths(projectRoot)
    expect(await pathExists(paths.grokConfig)).toBe(true)

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.grokConfig)).toBe(false)
  })

  it('keeps user sections of a TOML config and removes only the managed block', async () => {
    const projectRoot = await setupProject(['grok'])
    const paths = getProjectPaths(projectRoot)

    const existing = await readFile(paths.grokConfig, 'utf8')
    await writeFile(paths.grokConfig, `[ui]\nyolo = false\n\n${existing}`, 'utf8')

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readFile(paths.grokConfig, 'utf8')
    expect(after).toContain('[ui]')
    expect(after).not.toContain('mcp_servers')
  })

  it('deletes a settings file it created once its entries are gone', async () => {
    const projectRoot = await setupProject(['amp'])
    const paths = getProjectPaths(projectRoot)

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.ampSettings)).toBe(false)
  })

  it('keeps a settings file that also holds user settings', async () => {
    const projectRoot = await setupProject(['zed'])
    const paths = getProjectPaths(projectRoot)

    const settings = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    settings.theme = 'One Dark'
    await writeFile(paths.zedSettings, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readJsonFile<Record<string, unknown>>(paths.zedSettings)
    expect(after.theme).toBe('One Dark')
    expect(after.context_servers).toEqual({})
  })
})
