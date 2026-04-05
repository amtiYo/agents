import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getClaudeDesktopConfigPath,
  listClaudeDesktopManagedServerNames,
  mergeClaudeDesktopConfig,
  toManagedClaudeDesktopName
} from '../src/core/claudeDesktop.js'

const previousOverride = process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
  } else {
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = previousOverride
  }
})

describe('claude desktop helpers', () => {
  it('resolves config path from AGENTS_CLAUDE_DESKTOP_CONFIG_PATH override', () => {
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = './tmp/claude_desktop_config.json'
    expect(getClaudeDesktopConfigPath()).toBe(path.resolve('./tmp/claude_desktop_config.json'))
  })

  it('preserves user config while replacing only managed servers', () => {
    const projectRoot = '/repo-a'
    const otherProjectRoot = '/repo-b'
    const managedOld = toManagedClaudeDesktopName(projectRoot, 'old')
    const managedFilesystem = toManagedClaudeDesktopName(projectRoot, 'filesystem')
    const otherProjectFilesystem = toManagedClaudeDesktopName(otherProjectRoot, 'filesystem')
    const merged = mergeClaudeDesktopConfig({
      projectRoot,
      existing: {
        theme: 'solarized',
        mcpServers: {
          manual: { command: 'manual-server' },
          [managedOld]: { command: 'old-server' },
          [otherProjectFilesystem]: { command: 'other-project-server' }
        }
      },
      managedServers: {
        [managedFilesystem]: { command: 'npx' }
      }
    })

    expect(merged.theme).toBe('solarized')
    expect(merged.mcpServers).toMatchObject({
      manual: { command: 'manual-server' },
      [managedFilesystem]: { command: 'npx' },
      [otherProjectFilesystem]: { command: 'other-project-server' }
    })
    expect(merged.mcpServers).not.toHaveProperty(managedOld)
    expect(listClaudeDesktopManagedServerNames(merged, projectRoot)).toEqual([managedFilesystem])
    expect(listClaudeDesktopManagedServerNames(merged, otherProjectRoot)).toEqual([otherProjectFilesystem])
  })
})
