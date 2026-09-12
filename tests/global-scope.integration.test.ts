import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { runInit } from '../src/commands/init.js'
import { runReset } from '../src/commands/reset.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { toProjectScopedName } from '../src/core/globalScope.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousHome: string | undefined
let previousWindsurf: string | undefined

beforeEach(() => {
  previousHome = process.env.AGENTS_HOME_DIR
  previousWindsurf = process.env.AGENTS_WINDSURF_MCP_PATH
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.AGENTS_HOME_DIR
  else process.env.AGENTS_HOME_DIR = previousHome
  if (previousWindsurf === undefined) delete process.env.AGENTS_WINDSURF_MCP_PATH
  else process.env.AGENTS_WINDSURF_MCP_PATH = previousWindsurf

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

/** A project with one server, whose name is the same in every project here. */
async function projectWithServer(integration: string, command: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-global-scope-'))
  tempDirs.push(projectRoot)
  await runInit({ projectRoot, force: true })
  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = [integration] as typeof config.integrations.enabled
  config.mcp.servers = { fetch: { transport: 'stdio', command, args: ['serve'] } }
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

describe('entries in a config shared by every project', () => {
  it('keeps two projects with the same server name apart in the Windsurf config', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath

    const first = await projectWithServer('windsurf', 'first-server')
    const second = await projectWithServer('windsurf', 'second-server')

    await performSync({ projectRoot: first, check: false, verbose: false })
    await performSync({ projectRoot: second, check: false, verbose: false })

    const config = JSON.parse(await readFile(windsurfPath, 'utf8')) as {
      mcpServers: Record<string, { command?: string }>
    }
    const firstName = toProjectScopedName(first, 'fetch')
    const secondName = toProjectScopedName(second, 'fetch')

    expect(firstName).not.toBe(secondName)
    expect(config.mcpServers[firstName]?.command).toBe('first-server')
    expect(config.mcpServers[secondName]?.command).toBe('second-server')
  }, 25000)

  it('leaves the other project\'s entry in place on reset', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath

    const first = await projectWithServer('windsurf', 'first-server')
    const second = await projectWithServer('windsurf', 'second-server')
    await performSync({ projectRoot: first, check: false, verbose: false })
    await performSync({ projectRoot: second, check: false, verbose: false })

    await runReset({ projectRoot: first, localOnly: true })

    const config = JSON.parse(await readFile(windsurfPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(config.mcpServers[toProjectScopedName(first, 'fetch')]).toBeUndefined()
    expect(config.mcpServers[toProjectScopedName(second, 'fetch')]).toBeDefined()
  }, 25000)

  it('keeps two projects apart in the Goose config', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-global-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const first = await projectWithServer('goose', 'first-server')
    const second = await projectWithServer('goose', 'second-server')
    await performSync({ projectRoot: first, check: false, verbose: false })
    await performSync({ projectRoot: second, check: false, verbose: false })

    const doc = YAML.parse(await readFile(path.join(fakeHome, '.config', 'goose', 'config.yaml'), 'utf8')) as {
      extensions: Record<string, { cmd?: string; name?: string }>
    }
    const firstName = toProjectScopedName(first, 'fetch')
    const secondName = toProjectScopedName(second, 'fetch')

    expect(doc.extensions[firstName]?.cmd).toBe('first-server')
    expect(doc.extensions[firstName]?.name).toBe(firstName)
    expect(doc.extensions[secondName]?.cmd).toBe('second-server')
  }, 25000)

  it('replaces the bare entry a previous version wrote even without a state file', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath

    const projectRoot = await projectWithServer('windsurf', 'first-server')
    await performSync({ projectRoot, check: false, verbose: false })

    // What a fresh clone or `git clean -xfd` leaves: the entry written under the bare
    // name, and no record of who wrote it.
    const config = JSON.parse(await readFile(windsurfPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    const ours = config.mcpServers[toProjectScopedName(projectRoot, 'fetch')]
    await writeFile(
      windsurfPath,
      `${JSON.stringify({ mcpServers: { fetch: ours, mine: { command: 'manual' } } }, null, 2)}\n`,
      'utf8',
    )
    await rm(path.join(projectRoot, '.agents', 'generated'), { recursive: true, force: true })

    await performSync({ projectRoot, check: false, verbose: false })

    const after = JSON.parse(await readFile(windsurfPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(after.mcpServers.fetch).toBeUndefined()
    expect(after.mcpServers[toProjectScopedName(projectRoot, 'fetch')]).toBeDefined()
    expect(after.mcpServers.mine).toBeDefined()
  }, 25000)

  it('leaves a bare entry alone when its content is not this project\'s', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath
    await writeFile(
      windsurfPath,
      `${JSON.stringify({ mcpServers: { fetch: { command: 'users-own-fetch' } } }, null, 2)}\n`,
      'utf8',
    )

    const projectRoot = await projectWithServer('windsurf', 'first-server')
    const result = await performSync({ projectRoot, check: false, verbose: false })

    const after = JSON.parse(await readFile(windsurfPath, 'utf8')) as {
      mcpServers: Record<string, { command?: string }>
    }
    expect(after.mcpServers.fetch?.command).toBe('users-own-fetch')
    expect(result.warnings.join(' ')).toContain('not written by this project and was left alone')
  }, 25000)

  it('does not delete a bare entry on reset without a state file', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath

    const projectRoot = await projectWithServer('windsurf', 'first-server')
    await performSync({ projectRoot, check: false, verbose: false })

    const config = JSON.parse(await readFile(windsurfPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    config.mcpServers.fetch = { command: 'users-own-fetch' }
    await writeFile(windsurfPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await rm(path.join(projectRoot, '.agents', 'generated'), { recursive: true, force: true })

    await runReset({ projectRoot, localOnly: true })

    const after = JSON.parse(await readFile(windsurfPath, 'utf8')) as {
      mcpServers: Record<string, { command?: string }>
    }
    expect(after.mcpServers[toProjectScopedName(projectRoot, 'fetch')]).toBeUndefined()
    expect(after.mcpServers.fetch?.command).toBe('users-own-fetch')
  }, 25000)

  it('replaces the bare entry a previous version wrote', async () => {
    const globalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-global-ws-'))
    tempDirs.push(globalDir)
    const windsurfPath = path.join(globalDir, 'mcp_config.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfPath

    const projectRoot = await projectWithServer('windsurf', 'first-server')

    // The shape 0.9.0 left behind: a bare entry, recorded under that name in the state.
    await writeFile(
      windsurfPath,
      `${JSON.stringify({ mcpServers: { fetch: { command: 'old' }, mine: { command: 'manual' } } }, null, 2)}\n`,
      'utf8',
    )
    const statePath = path.join(projectRoot, '.agents', 'generated', 'windsurf.state.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify({ managedNames: ['fetch'] }, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const config = JSON.parse(await readFile(windsurfPath, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(config.mcpServers.fetch).toBeUndefined()
    expect(config.mcpServers[toProjectScopedName(projectRoot, 'fetch')]).toBeDefined()
    expect(config.mcpServers.mine).toBeDefined()
  }, 25000)
})
