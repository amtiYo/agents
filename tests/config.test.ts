import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createDefaultAgentsConfig, loadAgentsConfig } from '../src/core/config.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('config loading', () => {
  it('falls back to source-only when syncMode is invalid', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-config-'))
    tempDirs.push(projectRoot)
    const config = createDefaultAgentsConfig()
    const mutated = {
      ...config,
      syncMode: 'source_only'
    }

    await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
    await writeFile(
      path.join(projectRoot, '.agents', 'agents.json'),
      `${JSON.stringify(mutated, null, 2)}\n`,
      'utf8'
    )

    const loaded = await loadAgentsConfig(projectRoot)
    expect(loaded.syncMode).toBe('source-only')
  })
})
