import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runMcpAdd } from '../src/commands/mcp-add.js'
import { runMcpTest } from '../src/commands/mcp-test.js'

const tempDirs: string[] = []
let previousPathEnv: string | undefined

afterEach(async () => {
  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }
  previousPathEnv = undefined
  process.exitCode = undefined

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('mcp test runtime mode', () => {
  it('reports runtime health and stays successful when all probes are healthy', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-runtime-'))
    const binDir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-runtime-bin-'))
    tempDirs.push(projectRoot, binDir)

    await runInit({ projectRoot, force: true })
    await runMcpAdd({
      projectRoot,
      name: 'docs',
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['claude', 'gemini', 'cursor'],
      args: [],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: [],
      disabled: false,
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    await writeExecutable(path.join(binDir, 'claude'), [
      '#!/bin/sh',
      'echo "agents__docs: https://example.com/mcp (HTTP) - ✓ Connected"',
      'exit 0'
    ])
    await writeExecutable(path.join(binDir, 'gemini'), [
      '#!/bin/sh',
      'echo "✓ docs: https://example.com/mcp (sse) - Connected"',
      'exit 0'
    ])
    await writeExecutable(path.join(binDir, 'cursor-agent'), [
      '#!/bin/sh',
      'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
      '  echo "docs: ready"',
      '  exit 0',
      'fi',
      'exit 0'
    ])

    previousPathEnv = process.env.PATH
    process.env.PATH = `${binDir}:${previousPathEnv ?? ''}`

    const out = await captureStdout(async () => {
      await runMcpTest({
        projectRoot,
        name: 'docs',
        json: true,
        runtime: true,
        runtimeTimeoutMs: 2000
      })
    })

    const payload = JSON.parse(out) as {
      errors: number
      runtime?: { errors: number; availableIntegrations: string[] }
      results: Array<{ name: string; runtime?: Record<string, { status: string }> }>
    }
    expect(payload.errors).toBe(0)
    expect(payload.runtime?.errors).toBe(0)
    expect(payload.runtime?.availableIntegrations.sort()).toEqual(['claude', 'cursor', 'gemini'])
    expect(payload.results[0]?.runtime?.claude?.status).toBe('ok')
    expect(payload.results[0]?.runtime?.gemini?.status).toBe('ok')
    expect(payload.results[0]?.runtime?.cursor?.status).toBe('ok')
    expect(process.exitCode).toBeUndefined()
  })

  it('fails with exit code when an available runtime probe reports error', { timeout: 10000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-runtime-'))
    const binDir = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-runtime-bin-'))
    tempDirs.push(projectRoot, binDir)

    await runInit({ projectRoot, force: true })
    await runMcpAdd({
      projectRoot,
      name: 'docs',
      transport: 'http',
      url: 'https://example.com/mcp',
      targets: ['cursor'],
      args: [],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: [],
      disabled: false,
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    await writeExecutable(path.join(binDir, 'cursor-agent'), [
      '#!/bin/sh',
      'if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then',
      '  echo "docs: Error: Connection failed"',
      '  exit 0',
      'fi',
      'exit 0'
    ])

    previousPathEnv = process.env.PATH
    process.env.PATH = `${binDir}:${previousPathEnv ?? ''}`

    process.exitCode = undefined
    await runMcpTest({
      projectRoot,
      name: 'docs',
      json: true,
      runtime: true,
      runtimeTimeoutMs: 2000
    })

    expect(process.exitCode).toBe(1)
  })
})

async function writeExecutable(filePath: string, lines: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
  await chmod(filePath, 0o755)
}

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
