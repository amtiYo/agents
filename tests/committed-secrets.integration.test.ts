import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
const SECRET = 'sk-live-committed-secret-0123456789'

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

/** A project whose only server takes its token from local.json. */
async function projectWithSecret(enabled: string[], syncMode?: 'source-only' | 'commit-generated'): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-committed-secret-'))
  tempDirs.push(projectRoot)

  await runInit({ projectRoot, force: true })
  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = enabled as typeof config.integrations.enabled
  if (syncMode) config.syncMode = syncMode
  config.mcp.servers = {
    probe: {
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { API_TOKEN: '${API_TOKEN}' }
    }
  }
  await saveAgentsConfig(projectRoot, config)
  await writeFile(
    path.join(projectRoot, '.agents', 'local.json'),
    `${JSON.stringify({ mcpServers: { probe: { env: { API_TOKEN: SECRET } } } }, null, 2)}\n`,
    'utf8',
  )

  return projectRoot
}

describe('secrets in configs that are not gitignored', () => {
  it('keeps local.json values out of Amp, Zed and Kilo configs', { timeout: 25000 }, async () => {
    const projectRoot = await projectWithSecret(['amp', 'zed', 'kilo'])

    const result = await performSync({ projectRoot, check: false, verbose: false })

    for (const file of ['.amp/settings.json', '.zed/settings.json', '.kilo/kilo.jsonc']) {
      const content = await readFile(path.join(projectRoot, file), 'utf8')
      expect(content).not.toContain(SECRET)
      expect(content).toContain('${API_TOKEN}')
    }

    // Silence here would look like the token simply did not work.
    expect(result.warnings.join(' ')).toContain('env.API_TOKEN was written as it appears in .agents/agents.json')
  })

  it('still resolves the secret for configs it gitignores', { timeout: 25000 }, async () => {
    const projectRoot = await projectWithSecret(['codex', 'cursor'])

    await performSync({ projectRoot, check: false, verbose: false })

    const codex = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
    expect(codex).toContain(SECRET)
    const cursor = await readFile(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8')
    expect(cursor).toContain(SECRET)
  })

  it('keeps every generated config free of secrets in commit-generated mode', { timeout: 25000 }, async () => {
    const projectRoot = await projectWithSecret(['codex', 'cursor', 'gemini'], 'commit-generated')

    await performSync({ projectRoot, check: false, verbose: false })

    for (const file of ['.codex/config.toml', '.cursor/mcp.json', '.gemini/settings.json']) {
      const content = await readFile(path.join(projectRoot, file), 'utf8')
      expect(content).not.toContain(SECRET)
    }
  })

  it('keeps an exported environment value out of a committed config', { timeout: 25000 }, async () => {
    // No local.json here: the value comes from the shell, which is what the sync asks for.
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-exported-secret-'))
    tempDirs.push(projectRoot)
    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['amp', 'codex']
    config.mcp.servers = {
      probe: { transport: 'stdio', command: 'node', args: ['s.js'], env: { API_TOKEN: '${API_TOKEN}' } }
    }
    await saveAgentsConfig(projectRoot, config)

    const previous = process.env.API_TOKEN
    // The sync tells people to export exactly this variable so Amp can resolve it, which
    // makes the exported value the common case rather than an unusual one.
    process.env.API_TOKEN = 'sk-live-exported-0123456789'

    try {
      await performSync({ projectRoot, check: false, verbose: false })

      const amp = await readFile(path.join(projectRoot, '.amp', 'settings.json'), 'utf8')
      expect(amp).not.toContain('sk-live-exported-0123456789')
      expect(amp).toContain('${API_TOKEN}')

      // The gitignored config still gets the value, or the server would not start.
      const codex = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
      expect(codex).toContain('sk-live-exported-0123456789')
    } finally {
      if (previous === undefined) delete process.env.API_TOKEN
      else process.env.API_TOKEN = previous
    }
  })

  it('resolves a default from the committed file even for a committed config', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-committed-default-'))
    tempDirs.push(projectRoot)
    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['amp']
    config.mcp.servers = {
      probe: { transport: 'stdio', command: 'node', args: ['s.js'], env: { LOG_LEVEL: '${LOG_LEVEL:-error}' } }
    }
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    // The default is in the committed file already, so writing it leaks nothing.
    const amp = await readFile(path.join(projectRoot, '.amp', 'settings.json'), 'utf8')
    expect(amp).toContain('error')
  })

  it('keeps the secret out of .github/mcp.json, which the team reviews', { timeout: 25000 }, async () => {
    const projectRoot = await projectWithSecret(['copilot_cli'])
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.options.copilotCliPath = '.github/mcp.json'
    await saveAgentsConfig(projectRoot, config)

    const result = await performSync({ projectRoot, check: false, verbose: false })

    const content = await readFile(path.join(projectRoot, '.github', 'mcp.json'), 'utf8')
    expect(content).not.toContain(SECRET)
    expect(content).toContain('${API_TOKEN}')
    // Without the warning the server simply stops working with no stated reason, so the
    // message is part of the behaviour, not decoration.
    expect(result.warnings.join(' ')).toContain('"probe"')
    expect(result.warnings.join(' ')).toContain('env.API_TOKEN')
  })
})
