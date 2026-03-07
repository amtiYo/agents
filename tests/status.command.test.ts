import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runStatus } from '../src/commands/status.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import * as shell from '../src/core/shell.js'

const tempDirs: string[] = []
let previousWindsurfMcpPath: string | undefined
let previousAntigravityMcpPath: string | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (previousWindsurfMcpPath === undefined) {
    delete process.env.AGENTS_WINDSURF_MCP_PATH
  } else {
    process.env.AGENTS_WINDSURF_MCP_PATH = previousWindsurfMcpPath
  }
  if (previousAntigravityMcpPath === undefined) {
    delete process.env.AGENTS_ANTIGRAVITY_MCP_PATH
  } else {
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = previousAntigravityMcpPath
  }
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
    config.integrations.enabled = [
      'codex',
      'claude',
      'gemini',
      'cursor',
      'copilot_vscode',
      'antigravity',
      'windsurf',
      'opencode'
    ]
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

    expect(output).toContain('skipped (--fast)')
    expect(runCommandSpy).not.toHaveBeenCalled()
    expect(commandExistsSpy).not.toHaveBeenCalled()
  })

  it('reports files only for enabled integrations', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-status-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, config)

    const output = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: true,
        verbose: false,
        fast: true
      })
    })

    const parsed = JSON.parse(output) as { files: Record<string, boolean> }
    expect(parsed.files['.codex/config.toml']).toBeDefined()
    expect(parsed.files['.gemini/settings.json']).toBeUndefined()
    expect(parsed.files['.cursor/mcp.json']).toBeUndefined()
    expect(Object.keys(parsed.files).some((key) => key.toLowerCase().includes('antigravity'))).toBe(false)
    expect(parsed.files['opencode.json']).toBeUndefined()
    expect(Object.keys(parsed.files).some((key) => key.toLowerCase().includes('windsurf'))).toBe(false)
  })

  it('includes windsurf and opencode file states when enabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-status-'))
    const windsurfDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ws-status-'))
    tempDirs.push(projectRoot, windsurfDir)
    previousWindsurfMcpPath = process.env.AGENTS_WINDSURF_MCP_PATH
    process.env.AGENTS_WINDSURF_MCP_PATH = path.join(windsurfDir, 'mcp_config.json')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['windsurf', 'opencode']
    await saveAgentsConfig(projectRoot, config)
    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const output = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: true,
        verbose: false,
        fast: true
      })
    })

    const parsed = JSON.parse(output) as { files: Record<string, boolean> }
    expect(parsed.files['opencode.json']).toBe(true)
    expect(Object.keys(parsed.files).some((key) => key.includes('mcp_config.json'))).toBe(true)
  })

  it('includes root CLAUDE.md file state when Claude is enabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-status-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    vi.spyOn(shell, 'commandExists').mockImplementation(() => false)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const output = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: true,
        verbose: false,
        fast: true
      })
    })

    const parsed = JSON.parse(output) as { files: Record<string, boolean> }
    expect(parsed.files['CLAUDE.md']).toBe(true)
    expect(parsed.files['.claude/skills']).toBe(true)

    await writeFile(path.join(projectRoot, 'CLAUDE.md'), '# custom\n', 'utf8')

    const outputAfterCustom = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: true,
        verbose: false,
        fast: true
      })
    })

    const parsedAfterCustom = JSON.parse(outputAfterCustom) as { files: Record<string, boolean> }
    expect(parsedAfterCustom.files['CLAUDE.md']).toBe(true)
  }, 15000)

  it('omits Antigravity global file checks when global sync option is disabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-status-'))
    const antigravityDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ag-status-'))
    tempDirs.push(projectRoot, antigravityDir)
    previousAntigravityMcpPath = process.env.AGENTS_ANTIGRAVITY_MCP_PATH
    process.env.AGENTS_ANTIGRAVITY_MCP_PATH = path.join(antigravityDir, 'mcp.json')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    config.integrations.options.antigravityGlobalSync = false
    await saveAgentsConfig(projectRoot, config)
    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const output = await captureStdout(async () => {
      await runStatus({
        projectRoot,
        json: true,
        verbose: false,
        fast: false
      })
    })

    const parsed = JSON.parse(output) as { files: Record<string, boolean>; probes: Record<string, string> }
    expect(Object.keys(parsed.files).some((key) => key.includes('mcp.json') && key.includes('agents-ag-status'))).toBe(false)
    expect(parsed.probes.antigravity).toContain('global sync disabled')
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
