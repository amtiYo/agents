import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, mkdir, readlink, rm, unlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('claude commands/hooks bridges', () => {
  it('creates managed Claude command and hook bridges when source files exist', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-bridges-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await mkdir(path.join(projectRoot, '.agents', 'commands'), { recursive: true })
    await mkdir(path.join(projectRoot, '.agents', 'hooks'), { recursive: true })
    await writeFile(path.join(projectRoot, '.agents', 'commands', 'hello.md'), '# hello\n', 'utf8')
    await writeFile(path.join(projectRoot, '.agents', 'hooks', 'pre-tool-use.sh'), 'echo test\n', 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    await expectManagedBridge(
      path.join(projectRoot, '.claude', 'commands'),
      path.join(projectRoot, '.agents', 'commands')
    )
    await expectManagedBridge(
      path.join(projectRoot, '.claude', 'hooks'),
      path.join(projectRoot, '.agents', 'hooks')
    )
  })

  it('removes managed Claude command and hook bridges when source files disappear', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-bridges-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    await mkdir(path.join(projectRoot, '.agents', 'commands'), { recursive: true })
    await mkdir(path.join(projectRoot, '.agents', 'hooks'), { recursive: true })
    const commandFile = path.join(projectRoot, '.agents', 'commands', 'hello.md')
    const hookFile = path.join(projectRoot, '.agents', 'hooks', 'pre-tool-use.sh')
    await writeFile(commandFile, '# hello\n', 'utf8')
    await writeFile(hookFile, 'echo test\n', 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    await unlink(commandFile)
    await unlink(hookFile)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await exists(path.join(projectRoot, '.claude', 'commands'))).toBe(false)
    expect(await exists(path.join(projectRoot, '.claude', 'hooks'))).toBe(false)
  })
})

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

async function expectManagedBridge(bridgePath: string, sourcePath: string): Promise<void> {
  const info = await lstat(bridgePath)
  if (info.isSymbolicLink()) {
    const target = await readlink(bridgePath)
    expect(path.resolve(path.dirname(bridgePath), target)).toBe(sourcePath)
    return
  }

  expect(await exists(path.join(bridgePath, '.agents_bridge'))).toBe(true)
}
