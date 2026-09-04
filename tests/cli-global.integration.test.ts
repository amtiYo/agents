import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pathExists } from '../src/core/fs.js'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
let previousHomeDir: string | undefined

beforeEach(() => {
  previousHomeDir = process.env.AGENTS_HOME_DIR
})

afterEach(async () => {
  if (previousHomeDir === undefined) {
    delete process.env.AGENTS_HOME_DIR
  } else {
    process.env.AGENTS_HOME_DIR = previousHomeDir
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('CLI --global / -g flag integration', () => {
  it('runs init, connect, sync and status using --global flag from arbitrary working directory', async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-cli-home-'))
    const randomWorkdir = await mkdtemp(path.join(os.tmpdir(), 'agents-cli-workdir-'))
    tempDirs.push(fakeHome, randomWorkdir)

    const cliPath = path.resolve('src/cli.ts')
    const env = {
      ...process.env,
      AGENTS_HOME_DIR: fakeHome,
      AGENTS_NO_UPDATE_CHECK: '1',
      NO_COLOR: '1'
    }

    // 1. Run init --global from random directory
    await execFileAsync('npx', ['tsx', cliPath, 'init', '--global', '--force'], {
      cwd: randomWorkdir,
      env
    })

    expect(await pathExists(path.join(fakeHome, '.agents', 'agents.json'))).toBe(true)
    expect(await pathExists(path.join(randomWorkdir, '.agents'))).toBe(false)

    // 2. Run connect --llm opencode -g from random directory
    await execFileAsync('npx', ['tsx', cliPath, 'connect', '--llm', 'opencode', '-g'], {
      cwd: randomWorkdir,
      env
    })

    const opencodeGlobalPath = path.join(fakeHome, '.config', 'opencode', 'opencode.json')
    expect(await pathExists(opencodeGlobalPath)).toBe(true)
    expect(await pathExists(path.join(randomWorkdir, 'opencode.json'))).toBe(false)

    // 3. Check status --global --json
    const { stdout: statusStdout } = await execFileAsync('npx', ['tsx', cliPath, 'status', '--global', '--json'], {
      cwd: randomWorkdir,
      env
    })

    const statusParsed = JSON.parse(statusStdout) as {
      projectRoot: string
      enabledIntegrations: string[]
      files: Record<string, boolean>
    }

    expect(statusParsed.projectRoot).toBe(fakeHome)
    expect(statusParsed.enabledIntegrations).toContain('opencode')
    expect(statusParsed.files['~/.config/opencode/opencode.json']).toBe(true)

    // 4. Run mcp list -g --json
    const { stdout: mcpStdout } = await execFileAsync('npx', ['tsx', cliPath, 'mcp', 'list', '-g', '--json'], {
      cwd: randomWorkdir,
      env
    })
    const mcpParsed = JSON.parse(mcpStdout) as { servers: Array<{ name: string }> }
    expect(mcpParsed.servers.map((s) => s.name)).toContain('filesystem')
  })
})
