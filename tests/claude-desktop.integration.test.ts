import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { toManagedClaudeDesktopName } from '../src/core/claudeDesktop.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousClaudeDesktopConfigPath: string | undefined

beforeEach(() => {
  previousClaudeDesktopConfigPath = process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
})

afterEach(async () => {
  if (previousClaudeDesktopConfigPath === undefined) {
    delete process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
  } else {
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = previousClaudeDesktopConfigPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('claude desktop sync', () => {
  it('materializes Claude Desktop config and preserves user-defined entries', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-'))
    const desktopDir = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-global-'))
    const desktopConfigPath = path.join(desktopDir, 'claude_desktop_config.json')
    tempDirs.push(projectRoot, desktopDir)
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = desktopConfigPath

    await runInit({ projectRoot, force: true })
    await writeFile(
      desktopConfigPath,
      JSON.stringify({
        theme: 'sepia',
        mcpServers: {
          manual: {
            command: 'custom-server'
          }
        }
      }, null, 2),
      'utf8',
    )

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude_desktop']
    await saveAgentsConfig(projectRoot, config)
    const managedFilesystem = toManagedClaudeDesktopName(projectRoot, 'filesystem')

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const desktopConfig = JSON.parse(await readFile(desktopConfigPath, 'utf8')) as {
      theme?: string
      mcpServers?: Record<string, unknown>
    }
    expect(desktopConfig.theme).toBe('sepia')
    expect(Object.keys(desktopConfig.mcpServers ?? {})).toContain('manual')
    expect(Object.keys(desktopConfig.mcpServers ?? {})).toContain(managedFilesystem)

    const generated = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'claude-desktop.mcp.json'), 'utf8'),
    ) as { mcpServers?: Record<string, unknown> }
    expect(Object.keys(generated.mcpServers ?? {})).toContain(managedFilesystem)

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toHaveLength(0)
  })

  it('removes only managed Claude Desktop entries when integration is disabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-'))
    const desktopDir = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-global-'))
    const desktopConfigPath = path.join(desktopDir, 'claude_desktop_config.json')
    tempDirs.push(projectRoot, desktopDir)
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = desktopConfigPath

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude_desktop']
    await saveAgentsConfig(projectRoot, config)
    const managedFilesystem = toManagedClaudeDesktopName(projectRoot, 'filesystem')

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    await writeFile(
      desktopConfigPath,
      JSON.stringify({
        mcpServers: {
          manual: {
            command: 'custom-server'
          },
          ...(JSON.parse(await readFile(desktopConfigPath, 'utf8')) as { mcpServers?: Record<string, unknown> }).mcpServers
        }
      }, null, 2),
      'utf8',
    )

    const disabled = await loadAgentsConfig(projectRoot)
    disabled.integrations.enabled = []
    await saveAgentsConfig(projectRoot, disabled)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const desktopConfig = JSON.parse(await readFile(desktopConfigPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(Object.keys(desktopConfig.mcpServers ?? {})).toEqual(['manual'])
    expect(Object.keys(desktopConfig.mcpServers ?? {})).not.toContain(managedFilesystem)
  })

  it('preserves managed Claude Desktop entries from other projects', async () => {
    const projectRootA = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-a-'))
    const projectRootB = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-b-'))
    const desktopDir = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-desktop-global-'))
    const desktopConfigPath = path.join(desktopDir, 'claude_desktop_config.json')
    tempDirs.push(projectRootA, projectRootB, desktopDir)
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = desktopConfigPath

    await runInit({ projectRoot: projectRootA, force: true })
    await runInit({ projectRoot: projectRootB, force: true })

    const configA = await loadAgentsConfig(projectRootA)
    configA.integrations.enabled = ['claude_desktop']
    await saveAgentsConfig(projectRootA, configA)

    const configB = await loadAgentsConfig(projectRootB)
    configB.integrations.enabled = ['claude_desktop']
    await saveAgentsConfig(projectRootB, configB)

    const managedFilesystemA = toManagedClaudeDesktopName(projectRootA, 'filesystem')
    const managedFilesystemB = toManagedClaudeDesktopName(projectRootB, 'filesystem')

    await performSync({
      projectRoot: projectRootA,
      check: false,
      verbose: false
    })

    await performSync({
      projectRoot: projectRootB,
      check: false,
      verbose: false
    })

    let desktopConfig = JSON.parse(await readFile(desktopConfigPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(Object.keys(desktopConfig.mcpServers ?? {})).toEqual(
      expect.arrayContaining([managedFilesystemA, managedFilesystemB]),
    )

    const disabled = await loadAgentsConfig(projectRootB)
    disabled.integrations.enabled = []
    await saveAgentsConfig(projectRootB, disabled)

    await performSync({
      projectRoot: projectRootB,
      check: false,
      verbose: false
    })

    desktopConfig = JSON.parse(await readFile(desktopConfigPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(Object.keys(desktopConfig.mcpServers ?? {})).toContain(managedFilesystemA)
    expect(Object.keys(desktopConfig.mcpServers ?? {})).not.toContain(managedFilesystemB)
  })
})
