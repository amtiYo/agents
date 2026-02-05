import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runMcpAdd } from '../src/commands/mcp-add.js'
import { runMcpTest } from '../src/commands/mcp-test.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
  process.exitCode = undefined
})

describe('mcp test command', () => {
  it('returns non-zero exit code when validation fails', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-test-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    await runMcpAdd({
      projectRoot,
      name: 'broken',
      transport: 'stdio',
      command: 'definitely-not-a-real-command',
      args: [],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: [],
      targets: [],
      disabled: false,
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    process.exitCode = undefined
    await runMcpTest({
      projectRoot,
      json: true
    })

    expect(process.exitCode).toBe(1)
  })

  it('returns success for a valid http server', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-test-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    await runMcpAdd({
      projectRoot,
      name: 'remote-docs',
      transport: 'http',
      url: 'https://example.com/mcp',
      args: [],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: [],
      targets: [],
      disabled: false,
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    process.exitCode = undefined
    await runMcpTest({
      projectRoot,
      name: 'remote-docs',
      json: true
    })

    expect(process.exitCode).toBeUndefined()
  })
})
