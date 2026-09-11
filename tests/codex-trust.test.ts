import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureCodexProjectTrusted, getCodexTrustState, inspectCodexGlobalConfig } from '../src/core/trust.js'

const tempDirs: string[] = []
let previousConfigPath: string | undefined

async function writeGlobalConfig(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-trust-'))
  tempDirs.push(dir)
  const configPath = path.join(dir, 'config.toml')
  await writeFile(configPath, content, 'utf8')
  process.env.AGENTS_CODEX_CONFIG_PATH = configPath
  return configPath
}

beforeEach(() => {
  previousConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
})

afterEach(async () => {
  if (previousConfigPath === undefined) delete process.env.AGENTS_CODEX_CONFIG_PATH
  else process.env.AGENTS_CODEX_CONFIG_PATH = previousConfigPath

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('codex trust', () => {
  it('keeps comments, ordering and unrelated settings when adding trust', async () => {
    const configPath = await writeGlobalConfig(
      [
        '# my codex setup',
        'model = "gpt-5-codex"',
        '',
        '[projects."/other/project"]',
        'trust_level = "trusted"',
        '',
        '[features]',
        'web_search = true',
        ''
      ].join('\n'),
    )

    const result = await ensureCodexProjectTrusted('/repo/example')
    expect(result.changed).toBe(true)

    const content = await readFile(configPath, 'utf8')
    expect(content).toContain('# my codex setup')
    expect(content).toContain('model = "gpt-5-codex"')
    expect(content).toContain('[features]')
    expect(content).toContain('[projects."/repo/example"]')
    expect(content.indexOf('[features]')).toBeLessThan(content.indexOf('[projects."/repo/example"]'))
    expect(await getCodexTrustState('/repo/example')).toBe('trusted')
  })

  it('upgrades an existing untrusted entry in place', async () => {
    const configPath = await writeGlobalConfig(
      ['[projects."/repo/example"]', 'trust_level = "untrusted"', 'extra = 1', ''].join('\n'),
    )

    await ensureCodexProjectTrusted('/repo/example')

    const content = await readFile(configPath, 'utf8')
    expect(content).toContain('trust_level = "trusted"')
    expect(content).toContain('extra = 1')
    expect(content).not.toContain('untrusted')
  })

  it('adds trust_level to a project section that lacks it', async () => {
    const configPath = await writeGlobalConfig(['[projects."/repo/example"]', 'note = "hi"', ''].join('\n'))

    await ensureCodexProjectTrusted('/repo/example')

    const content = await readFile(configPath, 'utf8')
    expect(content).toContain('trust_level = "trusted"')
    expect(content).toContain('note = "hi"')
  })

  it('is a no-op when the project is already trusted', async () => {
    const configPath = await writeGlobalConfig(['[projects."/repo/example"]', 'trust_level = "trusted"', ''].join('\n'))
    const before = await readFile(configPath, 'utf8')

    const result = await ensureCodexProjectTrusted('/repo/example')

    expect(result.changed).toBe(false)
    expect(await readFile(configPath, 'utf8')).toBe(before)
  })

  it('reports a config Codex cannot parse as unreadable, not trusted', async () => {
    await writeGlobalConfig(
      [
        '[projects."/repo/example"]',
        'trust_level = "trusted"',
        '',
        '[projects."/repo/other"]',
        'trust_level = "trusted"',
        '',
        '[projects."/repo/other"]',
        'trust_level = "trusted"',
        ''
      ].join('\n'),
    )

    // Codex ignores every project while the file is broken, so "trusted" would lie.
    expect(await getCodexTrustState('/repo/example')).toBe('unreadable')
  })

  it('keeps indentation and an inline comment when raising trust', async () => {
    const configPath = await writeGlobalConfig(
      ['[projects."/repo/example"]', '  trust_level = "untrusted" # set by policy', ''].join('\n'),
    )

    await ensureCodexProjectTrusted('/repo/example')

    const content = await readFile(configPath, 'utf8')
    expect(content).toContain('  trust_level = "trusted" # set by policy')
  })

  it('refuses to edit a config Codex cannot parse', async () => {
    await writeGlobalConfig(
      [
        '[projects."/repo/example"]',
        'trust_level = "untrusted"',
        '',
        '[projects."/repo/example"]',
        'trust_level = "untrusted"',
        ''
      ].join('\n'),
    )

    await expect(ensureCodexProjectTrusted('/repo/example')).rejects.toThrow(/not valid TOML/i)
  })

  it('reports why a global config cannot be parsed', async () => {
    await writeGlobalConfig(['[projects."/a"]', 'trust_level = "trusted"', '', '[projects."/a"]', ''].join('\n'))

    const report = await inspectCodexGlobalConfig()
    expect(report.ok).toBe(false)
    expect(report.error).toBeTruthy()
  })

  it('creates the config when none exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-trust-'))
    tempDirs.push(dir)
    const configPath = path.join(dir, 'nested', 'config.toml')
    process.env.AGENTS_CODEX_CONFIG_PATH = configPath

    await ensureCodexProjectTrusted('/repo/example')

    const content = await readFile(configPath, 'utf8')
    expect(content).toBe('[projects."/repo/example"]\ntrust_level = "trusted"\n')
  })
})
