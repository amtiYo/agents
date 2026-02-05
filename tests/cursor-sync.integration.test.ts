import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousPathEnv: string | undefined

afterEach(async () => {
  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }
  previousPathEnv = undefined

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('cursor sync idempotency', () => {
  it('does not loop cursor-local-approval when runtime status is error', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-cursor-sync-'))
    const binDir = await mkdtemp(path.join(os.tmpdir(), 'agents-cursor-sync-bin-'))
    const callLog = path.join(binDir, 'cursor-calls.log')
    tempDirs.push(projectRoot, binDir)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['cursor']
    config.integrations.options.cursorAutoApprove = true
    config.mcp.servers.docs = {
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['cursor']
    }
    await saveAgentsConfig(projectRoot, config)

    await writeCursorAgent(path.join(binDir, 'cursor-agent'), callLog)
    previousPathEnv = process.env.PATH
    process.env.PATH = `${binDir}:${previousPathEnv ?? ''}`

    const first = await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    expect(first.changed).toContain('cursor-local-approval')
    expect(first.warnings.join(' ')).toContain('Cursor MCP connection errors for: docs')

    const second = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })

    expect(second.changed).not.toContain('cursor-local-approval')
    expect(second.warnings.join(' ')).toContain('Cursor MCP connection errors for: docs')

    const calls = await readFile(callLog, 'utf8')
    expect(calls).toContain('mcp list')
    expect(calls).not.toContain('mcp enable docs')
  }, 15000)
})

async function writeCursorAgent(filePath: string, callLogPath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const script = [
    '#!/bin/sh',
    `echo "$@" >> "${callLogPath}"`,
    'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
    '  echo "docs: Error: Connection failed"',
    '  echo "fetch: ready"',
    '  echo "filesystem: ready"',
    '  echo "git: ready"',
    '  exit 0',
    'fi',
    'exit 0'
  ].join('\n')
  await writeFile(filePath, `${script}\n`, 'utf8')
  await chmod(filePath, 0o755)
}
