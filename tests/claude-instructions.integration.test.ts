import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import * as shell from '../src/core/shell.js'

const tempDirs: string[] = []

beforeEach(() => {
  vi.spyOn(shell, 'commandExists').mockImplementation((command) => {
    if (command === 'claude') return false
    return false
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('claude instructions sync', () => {
  it('creates managed root CLAUDE.md wrapper and stays idempotent', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-instructions-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    const sync = await performSync({ projectRoot, check: false, verbose: false })

    expect(sync.changed).toContain('CLAUDE.md')
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).not.toContain('CLAUDE.md')
  }, 15000)

  it('reports drift for missing or modified managed CLAUDE.md wrapper', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-instructions-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })
    await unlink(path.join(projectRoot, 'CLAUDE.md'))

    const missing = await performSync({ projectRoot, check: true, verbose: false })
    expect(missing.changed).toContain('CLAUDE.md')

    await performSync({ projectRoot, check: false, verbose: false })
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# custom\n', 'utf8')

    const modified = await performSync({ projectRoot, check: true, verbose: false })
    expect(modified.changed).toContain('CLAUDE.md')
    expect(
      modified.warnings.some((warning) =>
        warning.includes('no longer matches the agents-managed wrapper'),
      ),
    ).toBe(true)
  }, 15000)

  it('preserves user-owned CLAUDE.md without perpetual drift', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-instructions-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# Team Claude notes\n', 'utf8')

    const sync = await performSync({ projectRoot, check: false, verbose: false })
    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe('# Team Claude notes\n')
    expect(
      sync.warnings.some((warning) =>
        warning.includes('preserving it and skipping agents wrapper sync'),
      ),
    ).toBe(true)

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).not.toContain('CLAUDE.md')
  }, 15000)

  it('removes only managed CLAUDE.md when Claude integration is disabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-instructions-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    await expect(readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).rejects.toThrow()

    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)
    await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# Custom Claude instructions\n', 'utf8')
    await performSync({ projectRoot, check: false, verbose: false })

    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await readFile(path.join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe(
      '# Custom Claude instructions\n',
    )
  }, 15000)
})
