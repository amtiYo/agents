import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'

const tempDirs: string[] = []
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('cli --no-sync wiring', () => {
  it('maps commander --no-sync to noSync=true for add/import/remove', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-cli-nosync-'))
    tempDirs.push(projectRoot)
    await runInit({ projectRoot, force: true })

    const addNoSync = runCli(
      [
        'mcp',
        'add',
        'docs',
        '--path',
        projectRoot,
        '--transport',
        'stdio',
        '--command',
        'npx',
        '--arg=-y',
        '--arg=@upstash/context7-mcp',
        '--no-sync',
        '--non-interactive'
      ]
    )
    expect(addNoSync.status).toBe(0)

    const importNoSync = runCli(
      [
        'mcp',
        'import',
        '--path',
        projectRoot,
        '--json',
        '{"mcpServers":{"remote-docs":{"url":"https://example.com/mcp"}}}',
        '--no-sync',
        '--non-interactive'
      ]
    )
    expect(importNoSync.status).toBe(0)

    const removeNoSync = runCli(
      [
        'mcp',
        'remove',
        'docs',
        '--path',
        projectRoot,
        '--no-sync'
      ]
    )
    expect(removeNoSync.status).toBe(0)

    const agentsAfterNoSync = await readAgentsConfig(projectRoot)
    expect(agentsAfterNoSync.lastSync).toBeNull()
    await expect(stat(path.join(projectRoot, '.agents', 'generated', 'codex.config.toml'))).rejects.toThrow()

    const addWithSync = runCli(
      [
        'mcp',
        'add',
        'docs2',
        '--path',
        projectRoot,
        '--transport',
        'stdio',
        '--command',
        'npx',
        '--arg=-y',
        '--arg=@upstash/context7-mcp',
        '--non-interactive'
      ]
    )
    expect(addWithSync.status).toBe(0)

    const agentsAfterSync = await readAgentsConfig(projectRoot)
    expect(typeof agentsAfterSync.lastSync).toBe('string')
    await expect(stat(path.join(projectRoot, '.agents', 'generated', 'codex.config.toml'))).resolves.toBeTruthy()
  }, 30_000)
})

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const result = spawnSync('node', ['--import', 'tsx', cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENTS_NO_UPDATE_CHECK: '1'
    }
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

async function readAgentsConfig(projectRoot: string): Promise<{ lastSync: string | null }> {
  const parsed = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8')) as { lastSync: string | null }
  return parsed
}
