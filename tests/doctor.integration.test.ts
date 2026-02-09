import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runDoctor } from '../src/commands/doctor.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  process.exitCode = undefined
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('doctor command', () => {
  it('reports invalid TOML in materialized codex config as error', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    await writeFile(path.join(projectRoot, '.codex', 'config.toml'), '[invalid\n', 'utf8')

    const output = await captureStdout(async () => {
      await runDoctor({ projectRoot, fix: false })
    })

    expect(output).toContain('Invalid TOML in .codex/config.toml')
    expect(process.exitCode).toBe(1)
  }, 15000)

  it('reports invalid env/header keys as errors', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers.invalid = {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {
        'BAD KEY': '123'
      },
      headers: {
        'Bad Header': 'x'
      }
    }
    await saveAgentsConfig(projectRoot, config)

    const output = await captureStdout(async () => {
      await runDoctor({ projectRoot, fix: false })
    })

    expect(output).toContain('MCP server "invalid" has invalid environment variable key "BAD KEY"')
    expect(output).toContain('MCP server "invalid" has invalid header key "Bad Header"')
    expect(process.exitCode).toBe(1)
  }, 15000)

  it('supports fix dry-run without mutating files', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-doctor-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const output = await captureStdout(async () => {
      await runDoctor({ projectRoot, fix: false, fixDryRun: true })
    })

    expect(output).toContain('Dry-run (would apply):')
    expect(output).toContain('Would run agents sync after fixes.')
    expect(output).toContain('Next: run "agents doctor --fix" to apply these changes.')
  }, 15000)
})

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  ;(process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    chunks.push(chunk)
    return true
  }) as unknown as typeof process.stdout.write

  try {
    await fn()
  } finally {
    ;(process.stdout.write as unknown as typeof process.stdout.write) = originalWrite as unknown as typeof process.stdout.write
  }

  return chunks.join('')
}
