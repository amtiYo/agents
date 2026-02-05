import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { parse } from 'jsonc-parser'
import { afterEach, describe, expect, it } from 'vitest'
import { syncVscodeSettings } from '../src/core/vscodeSettings.js'
import { readJson } from '../src/core/fs.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('VS Code settings sync', () => {
  it('adds missing excludes without overriding existing keys', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-vscode-'))
    tempDirs.push(root)

    const settingsPath = path.join(root, '.vscode', 'settings.json')
    const statePath = path.join(root, '.agents', 'generated', 'vscode.settings.state.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(
      settingsPath,
      [
        '{',
        '  // keep this',
        '  "files.exclude": {',
        '    "**/.codex": false',
        '  },',
        '  "search.exclude": {}',
        '}'
      ].join('\n'),
      'utf8',
    )

    const changed: string[] = []
    const warnings: string[] = []
    await syncVscodeSettings({
      settingsPath,
      statePath,
      hiddenPaths: ['**/.codex', '**/.claude'],
      hideGenerated: true,
      check: false,
      changed,
      warnings,
      projectRoot: root
    })

    expect(warnings).toHaveLength(0)
    const updated = parse(await readFile(settingsPath, 'utf8')) as Record<string, Record<string, boolean>>
    expect(updated['files.exclude']?.['**/.codex']).toBe(false)
    expect(updated['search.exclude']?.['**/.codex']).toBe(true)
    expect(updated['files.exclude']?.['**/.claude']).toBe(true)
    expect(updated['search.exclude']?.['**/.claude']).toBe(true)

    const state = await readJson<{ managedPaths: string[] }>(statePath)
    expect(state.managedPaths).toContain('**/.codex')
    expect(state.managedPaths).toContain('**/.claude')
  })

  it('removes only managed excludes when hideGenerated is disabled', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-vscode-'))
    tempDirs.push(root)

    const settingsPath = path.join(root, '.vscode', 'settings.json')
    const statePath = path.join(root, '.agents', 'generated', 'vscode.settings.state.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          'files.exclude': {
            '**/.codex': true,
            '**/custom': true
          },
          'search.exclude': {
            '**/.codex': true,
            '**/custom': true
          }
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(statePath, JSON.stringify({ managedPaths: ['**/.codex'] }, null, 2), 'utf8')

    const changed: string[] = []
    const warnings: string[] = []
    await syncVscodeSettings({
      settingsPath,
      statePath,
      hiddenPaths: ['**/.codex', '**/.claude'],
      hideGenerated: false,
      check: false,
      changed,
      warnings,
      projectRoot: root
    })

    expect(warnings).toHaveLength(0)
    const updated = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, Record<string, boolean>>
    expect(updated['files.exclude']?.['**/.codex']).toBeUndefined()
    expect(updated['search.exclude']?.['**/.codex']).toBeUndefined()
    expect(updated['files.exclude']?.['**/custom']).toBe(true)
    expect(updated['search.exclude']?.['**/custom']).toBe(true)

    const state = await readJson<{ managedPaths: string[] }>(statePath)
    expect(state.managedPaths).toHaveLength(0)
  })

  it('skips update when settings file cannot be parsed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-vscode-'))
    tempDirs.push(root)

    const settingsPath = path.join(root, '.vscode', 'settings.json')
    const statePath = path.join(root, '.agents', 'generated', 'vscode.settings.state.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, '{ invalid jsonc', 'utf8')

    const changed: string[] = []
    const warnings: string[] = []
    await syncVscodeSettings({
      settingsPath,
      statePath,
      hiddenPaths: ['**/.codex'],
      hideGenerated: true,
      check: false,
      changed,
      warnings,
      projectRoot: root
    })

    expect(changed).toHaveLength(0)
    expect(warnings.join(' ')).toContain('Cannot parse .vscode/settings.json')
    expect(await readFile(settingsPath, 'utf8')).toContain('invalid jsonc')
  })
})
