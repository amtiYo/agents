import os from 'node:os'
import path from 'node:path'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runDoctor } from '../src/commands/doctor.js'
import { runInit } from '../src/commands/init.js'
import { runReset } from '../src/commands/reset.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists } from '../src/core/fs.js'
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

async function project(enabled: string[]): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-review-fix-'))
  tempDirs.push(projectRoot)
  await runInit({ projectRoot, force: true })
  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = enabled as typeof config.integrations.enabled
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

describe('reset and the global Windsurf config', () => {
  it('removes this project\'s servers and keeps entries it did not write', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-review-home-'))
    tempDirs.push(fakeHome)
    const windsurfFile = path.join(fakeHome, 'windsurf_mcp.json')
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfFile
    await writeFile(
      windsurfFile,
      `${JSON.stringify({ mcpServers: { mine: { command: 'node' } } }, null, 2)}\n`,
      'utf8',
    )

    const projectRoot = await project(['windsurf'])
    await performSync({ projectRoot, check: false, verbose: false })

    const scopedFetch = toProjectScopedName(projectRoot, 'fetch')
    const afterSync = JSON.parse(await readFile(windsurfFile, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(Object.keys(afterSync.mcpServers)).toContain(scopedFetch)
    expect(afterSync.mcpServers.mine).toBeDefined()

    await runReset({ projectRoot, localOnly: true })

    const afterReset = JSON.parse(await readFile(windsurfFile, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(afterReset.mcpServers[scopedFetch]).toBeUndefined()
    expect(afterReset.mcpServers.mine).toBeDefined()
  })
})

describe('doctor reports broken configs of every enabled integration', () => {
  it('flags an invalid Zed settings file and an invalid Goose config', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-review-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const projectRoot = await project(['zed', 'goose'])
    await mkdir(path.join(projectRoot, '.zed'), { recursive: true })
    await writeFile(path.join(projectRoot, '.zed', 'settings.json'), '{ "context_servers": ', 'utf8')

    const gooseConfig = path.join(fakeHome, '.config', 'goose', 'config.yaml')
    await mkdir(path.dirname(gooseConfig), { recursive: true })
    await writeFile(gooseConfig, 'extensions:\n  - [unclosed\n', 'utf8')

    const output = await captureStdout(async () => {
      await runDoctor({ projectRoot, fix: false })
    })

    expect(output).toContain('Invalid JSONC in')
    expect(output).toContain('Invalid YAML in')
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
    ;(process.stdout.write as unknown as typeof process.stdout.write) =
      originalWrite as unknown as typeof process.stdout.write
  }

  return chunks.join('')
}

describe('what the setup wizard counts as leftovers', () => {
  it('ignores a config that lives outside the project', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-review-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    // Goose keeps its config in the home directory, so it is there for every project and
    // says nothing about this one. A fresh project must not be offered a cleanup.
    const gooseConfig = path.join(fakeHome, '.config', 'goose', 'config.yaml')
    await mkdir(path.dirname(gooseConfig), { recursive: true })
    await writeFile(gooseConfig, 'extensions: {}\n', 'utf8')

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-review-fresh-'))
    tempDirs.push(projectRoot)

    const { shouldOfferCleanup } = await import('../src/commands/start.js')
    expect(await shouldOfferCleanup(projectRoot)).toBe(false)

    await mkdir(path.join(projectRoot, '.codex'), { recursive: true })
    await writeFile(path.join(projectRoot, '.codex', 'config.toml'), '\n', 'utf8')
    expect(await shouldOfferCleanup(projectRoot)).toBe(true)
  })
})

describe('one broken integration does not stop the others', () => {
  it('names the integration and keeps writing the rest', { timeout: 25000 }, async () => {
    const projectRoot = await project(['cursor', 'junie'])

    // A directory where a file belongs makes every write to it fail.
    await mkdir(path.join(projectRoot, '.cursor', 'mcp.json'), { recursive: true })

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('cursor')
    expect(await pathExists(path.join(projectRoot, '.junie', 'mcp', 'mcp.json'))).toBe(true)
  })
})

describe('server validation follows the enabled integrations', () => {
  it('ignores an invalid env key aimed at a tool the project does not use', { timeout: 25000 }, async () => {
    const projectRoot = await project(['codex'])
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers = {
      broken: { transport: 'stdio', command: 'node', targets: ['zed'], env: { 'BAD KEY': 'value' } },
      fine: { transport: 'stdio', command: 'node', targets: ['codex'] }
    }
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    const codex = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
    expect(codex).toContain('fine')
  })

  it('still rejects a control character in a command of an enabled tool', { timeout: 25000 }, async () => {
    const projectRoot = await project(['codex'])
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers = {
      evil: { transport: 'stdio', command: 'node\nsandbox_mode = "danger-full-access"', targets: ['codex'] }
    }
    await saveAgentsConfig(projectRoot, config)

    await expect(performSync({ projectRoot, check: false, verbose: false })).rejects.toThrow(/control characters/)
  })
})

describe('entries the sync did not write', () => {
  it('leaves an extension of the same name alone because entries carry the project', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-review-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const gooseConfig = path.join(fakeHome, '.config', 'goose', 'config.yaml')
    await mkdir(path.dirname(gooseConfig), { recursive: true })
    await writeFile(gooseConfig, '# my goose config\nextensions:\n  fetch:\n    name: fetch\n    enabled: true\n', 'utf8')

    const projectRoot = await project(['goose'])
    await performSync({ projectRoot, check: false, verbose: false })

    const written = await readFile(gooseConfig, 'utf8')
    // The user's own `fetch` survives next to this project's scoped entry.
    expect(written).toContain('\n  fetch:')
    expect(written).toContain(toProjectScopedName(projectRoot, 'fetch'))
    expect(written).toContain('# my goose config')
  })

  it('warns when it replaces an entry it did not write in a project-local config', { timeout: 25000 }, async () => {
    const projectRoot = await project(['antigravity'])
    const workspaceMcp = path.join(projectRoot, '.agents', 'mcp_config.json')
    await writeFile(
      workspaceMcp,
      `${JSON.stringify({ mcpServers: { fetch: { command: 'mine' } } }, null, 2)}\n`,
      'utf8',
    )

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('was already there and not written by this CLI')
  })

  it('keeps a comment in the Goose config when reset empties it', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-review-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const projectRoot = await project(['goose'])
    await performSync({ projectRoot, check: false, verbose: false })

    const gooseConfig = path.join(fakeHome, '.config', 'goose', 'config.yaml')
    const synced = await readFile(gooseConfig, 'utf8')
    await writeFile(gooseConfig, `# keep me\n${synced}`, 'utf8')

    await runReset({ projectRoot, localOnly: true })

    expect(await pathExists(gooseConfig)).toBe(true)
    expect(await readFile(gooseConfig, 'utf8')).toContain('keep me')
  })
})

describe('an existing skills symlink that points elsewhere', () => {
  it('is left alone with a warning instead of being replaced', { timeout: 25000 }, async () => {
    const projectRoot = await project(['claude'])
    const elsewhere = path.join(projectRoot, 'shared-skills')
    await mkdir(elsewhere, { recursive: true })
    await mkdir(path.join(projectRoot, '.claude'), { recursive: true })
    await symlink(path.relative(path.join(projectRoot, '.claude'), elsewhere), path.join(projectRoot, '.claude', 'skills'))

    const result = await performSync({ projectRoot, check: false, verbose: false })

    const bridge = path.join(projectRoot, '.claude', 'skills')
    expect((await lstat(bridge)).isSymbolicLink()).toBe(true)
    expect(await readFile(path.join(bridge, '..', 'skills', '..', '..', 'shared-skills', '.keep'), 'utf8').catch(() => ''))
      .toBe('')
    expect(result.warnings.join(' ')).toContain('pointing somewhere else')
  })
})
