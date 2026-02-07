import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runStatus } from '../src/commands/status.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import * as shell from '../src/core/shell.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('status command', () => {
  it('skips external probes in --fast mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-status-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex', 'claude', 'gemini', 'cursor', 'copilot_vscode', 'antigravity']
    await saveAgentsConfig(projectRoot, config)

    const runCommandSpy = vi.spyOn(shell, 'runCommand')
    const commandExistsSpy = vi.spyOn(shell, 'commandExists')

    const output = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: false,
        verbose: false,
        fast: true
      })
    })

    expect(output).toContain('Probes: skipped (--fast)')
    expect(runCommandSpy).not.toHaveBeenCalled()
    expect(commandExistsSpy).not.toHaveBeenCalled()
  })
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
