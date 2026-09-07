import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runDoctor } from '../src/commands/doctor.js'
import { runReset } from '../src/commands/reset.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'

const tempDirs: string[] = []
let previousHomeDir: string | undefined
let previousXdgConfigHome: string | undefined

beforeEach(() => {
  previousHomeDir = process.env.AGENTS_HOME_DIR
  previousXdgConfigHome = process.env.XDG_CONFIG_HOME
})

afterEach(async () => {
  if (previousHomeDir === undefined) {
    delete process.env.AGENTS_HOME_DIR
  } else {
    process.env.AGENTS_HOME_DIR = previousHomeDir
  }

  if (previousXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME
  } else {
    process.env.XDG_CONFIG_HOME = previousXdgConfigHome
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('global installation and OpenCode config sync', () => {
  it('correctly resolves global paths when projectRoot is home directory', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const paths = getProjectPaths(fakeHome)
    expect(paths.isHome).toBe(true)
    expect(paths.opencodeDir).toBe(path.join(fakeHome, '.config', 'opencode'))
    expect(paths.opencodeConfig).toBe(path.join(fakeHome, '.config', 'opencode', 'opencode.json'))
  })

  it('respects XDG_CONFIG_HOME in global mode', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    const fakeXdg = await mkdtemp(path.join(os.tmpdir(), 'agents-xdg-'))
    tempDirs.push(fakeHome, fakeXdg)
    process.env.AGENTS_HOME_DIR = fakeHome
    process.env.XDG_CONFIG_HOME = fakeXdg

    const paths = getProjectPaths(fakeHome)
    expect(paths.isHome).toBe(true)
    expect(paths.opencodeDir).toBe(path.join(fakeXdg, 'opencode'))
    expect(paths.opencodeConfig).toBe(path.join(fakeXdg, 'opencode', 'opencode.json'))
  })

  it('materializes OpenCode config at ~/.config/opencode/opencode.json in global mode', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    await runInit({ projectRoot: fakeHome, force: true })

    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(fakeHome, config)

    const syncResult = await performSync({
      projectRoot: fakeHome,
      check: false,
      verbose: false
    })

    const expectedConfigPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json')
    expect(await pathExists(expectedConfigPath)).toBe(true)
    expect(await pathExists(path.join(fakeHome, 'opencode.json'))).toBe(false)
    expect(syncResult.changed).toContain(path.join('.config', 'opencode', 'opencode.json'))

    const parsed = JSON.parse(await readFile(expectedConfigPath, 'utf8')) as {
      mcp?: Record<string, unknown>
    }
    expect(parsed.mcp).toBeDefined()
    expect(Object.keys(parsed.mcp ?? {})).toContain('filesystem')
  })

  it('preserves existing global OpenCode settings during sync', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const configDir = path.join(fakeHome, '.config', 'opencode')
    await mkdir(configDir, { recursive: true })
    const configPath = path.join(configDir, 'opencode.json')
    await writeFile(
      configPath,
      JSON.stringify({
        theme: 'catppuccin',
        default_agent: 'code-review',
        mcp: {
          personal: {
            command: ['node', 'personal-mcp.js']
          }
        }
      }, null, 2),
      'utf8'
    )

    await runInit({ projectRoot: fakeHome, force: true })
    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(fakeHome, config)

    await performSync({
      projectRoot: fakeHome,
      check: false,
      verbose: false
    })

    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as {
      theme?: string
      default_agent?: string
      mcp?: Record<string, unknown>
    }
    expect(parsed.theme).toBe('catppuccin')
    expect(parsed.default_agent).toBe('code-review')
    expect(Object.keys(parsed.mcp ?? {})).toContain('filesystem')
    expect(Object.keys(parsed.mcp ?? {})).not.toContain('personal')
  })

  it('migrates settings from legacy ~/opencode.json if global config does not exist yet', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const legacyPath = path.join(fakeHome, 'opencode.json')
    await writeFile(
      legacyPath,
      JSON.stringify({
        theme: 'dracula',
        custom_key: 'custom_value'
      }, null, 2),
      'utf8'
    )

    await runInit({ projectRoot: fakeHome, force: true })
    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(fakeHome, config)

    const syncResult = await performSync({
      projectRoot: fakeHome,
      check: false,
      verbose: false
    })

    expect(syncResult.warnings.some((w) => w.includes('Migrated existing OpenCode settings from legacy ~/opencode.json'))).toBe(true)

    const newPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json')
    expect(await pathExists(newPath)).toBe(true)

    const parsed = JSON.parse(await readFile(newPath, 'utf8')) as {
      theme?: string
      custom_key?: string
      mcp?: Record<string, unknown>
    }
    expect(parsed.theme).toBe('dracula')
    expect(parsed.custom_key).toBe('custom_value')
    expect(parsed.mcp).toBeDefined()
  })

  it('warns about legacy ~/opencode.json in doctor', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    await runInit({ projectRoot: fakeHome, force: true })
    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(fakeHome, config)

    await performSync({ projectRoot: fakeHome, check: false, verbose: false })

    // Create legacy misplaced opencode.json in home
    await writeFile(path.join(fakeHome, 'opencode.json'), '{}\n', 'utf8')

    let output = ''
    const originalStdoutWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => {
      output += String(chunk)
      return true
    }

    try {
      await runDoctor({ projectRoot: fakeHome, fix: false })
    } finally {
      process.stdout.write = originalStdoutWrite
    }

    expect(output).toContain('Found opencode.json in home directory (~/opencode.json)')
  })

  it('resets global OpenCode managed config while preserving manual settings', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    await runInit({ projectRoot: fakeHome, force: true })
    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(fakeHome, config)

    await performSync({ projectRoot: fakeHome, check: false, verbose: false })

    const configPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json')
    const current = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    current.user_setting = 'custom'
    await writeFile(configPath, JSON.stringify(current, null, 2), 'utf8')

    await runReset({ projectRoot: fakeHome, localOnly: false, hard: false })

    expect(await pathExists(configPath)).toBe(true)
    const afterReset = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>
    expect(afterReset.user_setting).toBe('custom')
    expect(afterReset.mcp).toBeUndefined()
  })
})
