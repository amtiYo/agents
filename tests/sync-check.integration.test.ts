import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runSync } from '../src/commands/sync.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { removeIfExists } from '../src/core/fs.js'

const tempDirs: string[] = []

afterEach(async () => {
  process.exitCode = undefined
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('sync --check behavior', () => {
  it('is read-only and does not create generated dir or lock file', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-check-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const generatedDir = path.join(projectRoot, '.agents', 'generated')
    await removeIfExists(generatedDir)

    await runSync({
      projectRoot,
      check: true,
      verbose: false
    })

    await expect(stat(generatedDir)).rejects.toThrow()
    await expect(readFile(path.join(generatedDir, 'sync.lock'), 'utf8')).rejects.toThrow()
    expect(process.exitCode).toBe(2)
  })

  it('does not create integration parent dirs in check mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-sync-check-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await runSync({
      projectRoot,
      check: true,
      verbose: false
    })

    await expect(stat(path.join(projectRoot, '.claude'))).rejects.toThrow()
  })
})

