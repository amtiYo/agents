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

  it('keeps the secret out of .github/mcp.json, which the team reviews', { timeout: 25000 }, async () => {
    const projectRoot = await projectWithSecret(['copilot_cli'])
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.options.copilotCliPath = '.github/mcp.json'
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    const content = await readFile(path.join(projectRoot, '.github', 'mcp.json'), 'utf8')
    expect(content).not.toContain(SECRET)
    expect(content).toContain('${API_TOKEN}')
  })
})
