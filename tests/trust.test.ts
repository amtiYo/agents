import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../src/core/trust.js'

const tempDirs: string[] = []
let previousCodexConfigPath: string | undefined

beforeEach(() => {
  previousCodexConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
})

afterEach(async () => {
  if (previousCodexConfigPath === undefined) {
    delete process.env.AGENTS_CODEX_CONFIG_PATH
  } else {
    process.env.AGENTS_CODEX_CONFIG_PATH = previousCodexConfigPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('codex trust helpers', () => {
  it('marks project as trusted in codex config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-trust-'))
    tempDirs.push(dir)

    const configPath = path.join(dir, 'codex.toml')
    process.env.AGENTS_CODEX_CONFIG_PATH = configPath

    const projectRoot = '/tmp/example-project'
    const first = await ensureCodexProjectTrusted(projectRoot)
    const second = await ensureCodexProjectTrusted(projectRoot)

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(await getCodexTrustState(projectRoot)).toBe('trusted')

    const rendered = await readFile(configPath, 'utf8')
    expect(rendered).toContain('[projects."/tmp/example-project"]')
    expect(rendered).toContain('trust_level = "trusted"')
  })

  it('returns untrusted when no config exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-trust-'))
    tempDirs.push(dir)

    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(dir, 'missing.toml')
    expect(await getCodexTrustState('/tmp/none')).toBe('untrusted')
  })
})
