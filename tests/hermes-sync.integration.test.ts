import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
const originalHermesConfigPath = process.env.AGENTS_HERMES_CONFIG_PATH

interface HermesTestConfig {
  mcp_servers: Record<string, { url?: string } | undefined>
  platform_toolsets: Record<string, string[]>
}

afterEach(async () => {
  if (originalHermesConfigPath === undefined) {
    delete process.env.AGENTS_HERMES_CONFIG_PATH
  } else {
    process.env.AGENTS_HERMES_CONFIG_PATH = originalHermesConfigPath
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('Hermes workspace sync', () => {
  it('merges, checks, retargets and cleans only workspace-owned servers', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-hermes-sync-'))
    const hermesRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-hermes-configs-'))
    tempDirs.push(projectRoot, hermesRoot)
    const firstConfig = path.join(hermesRoot, 'first', 'config.yaml')
    const secondConfig = path.join(hermesRoot, 'second', 'config.yaml')
    await mkdir(path.dirname(firstConfig), { recursive: true })
    await mkdir(path.dirname(secondConfig), { recursive: true })
    const manualYaml = `# preserve me
mcp_servers:
  manual:
    url: https://manual.example/mcp
platform_toolsets:
  telegram: [manual]
`
    await writeFile(firstConfig, manualYaml, 'utf8')
    await writeFile(secondConfig, manualYaml, 'utf8')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['hermes']
    config.integrations.options.hermesProfile = 'ignored-by-test-override'
    config.mcp.servers = {
      utilities: {
        transport: 'http',
        url: 'https://utilities.example/v1/mcp',
        targets: ['hermes']
      }
    }
    await saveAgentsConfig(projectRoot, config)

    process.env.AGENTS_HERMES_CONFIG_PATH = firstConfig
    await performSync({ projectRoot, check: false, verbose: false })
    const firstApplied = parse(await readFile(firstConfig, 'utf8')) as HermesTestConfig
    expect(firstApplied.mcp_servers.manual.url).toBe('https://manual.example/mcp')
    expect(firstApplied.mcp_servers.utilities.url).toBe('https://utilities.example/v1/mcp')
    expect(firstApplied.platform_toolsets.telegram).toEqual(['manual', 'utilities'])

    const cleanCheck = await performSync({ projectRoot, check: true, verbose: false })
    expect(cleanCheck.changed).not.toContain(firstConfig)

    config.mcp.servers.utilities.url = 'https://utilities.example/v2/mcp'
    await saveAgentsConfig(projectRoot, config)
    const beforeCheck = await readFile(firstConfig, 'utf8')
    const drift = await performSync({ projectRoot, check: true, verbose: false })
    expect(drift.changed).toContain(firstConfig)
    expect(await readFile(firstConfig, 'utf8')).toBe(beforeCheck)
    await performSync({ projectRoot, check: false, verbose: false })

    process.env.AGENTS_HERMES_CONFIG_PATH = secondConfig
    await performSync({ projectRoot, check: false, verbose: false })
    const cleanedFirst = parse(await readFile(firstConfig, 'utf8')) as HermesTestConfig
    const appliedSecond = parse(await readFile(secondConfig, 'utf8')) as HermesTestConfig
    expect(cleanedFirst.mcp_servers.manual).toBeDefined()
    expect(cleanedFirst.mcp_servers.utilities).toBeUndefined()
    expect(appliedSecond.mcp_servers.utilities.url).toBe('https://utilities.example/v2/mcp')

    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })
    const disabled = parse(await readFile(secondConfig, 'utf8')) as HermesTestConfig
    expect(disabled.mcp_servers.manual).toBeDefined()
    expect(disabled.mcp_servers.utilities).toBeUndefined()
    expect(disabled.platform_toolsets.telegram).toEqual(['manual'])

    const state = JSON.parse(await readFile(getProjectPaths(projectRoot).generatedHermesState, 'utf8')) as unknown
    expect(state).toEqual({ configs: {} })
  })
})
