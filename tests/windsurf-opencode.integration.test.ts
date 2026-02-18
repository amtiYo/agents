import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []
let previousWindsurfMcpPath: string | undefined

beforeEach(() => {
  previousWindsurfMcpPath = process.env.AGENTS_WINDSURF_MCP_PATH
})

afterEach(async () => {
  if (previousWindsurfMcpPath === undefined) {
    delete process.env.AGENTS_WINDSURF_MCP_PATH
  } else {
    process.env.AGENTS_WINDSURF_MCP_PATH = previousWindsurfMcpPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('windsurf + opencode sync', () => {
  it('materializes windsurf global MCP and project opencode config', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-wo-'))
    const windsurfGlobalDir = await mkdtemp(path.join(os.tmpdir(), 'agents-ws-global-'))
    tempDirs.push(projectRoot, windsurfGlobalDir)
    process.env.AGENTS_WINDSURF_MCP_PATH = path.join(windsurfGlobalDir, 'mcp_config.json')

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['windsurf', 'opencode']
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const windsurfGlobal = JSON.parse(
      await readFile(path.join(windsurfGlobalDir, 'mcp_config.json'), 'utf8'),
    ) as { mcpServers?: Record<string, unknown> }
    expect(Object.keys(windsurfGlobal.mcpServers ?? {})).toContain('filesystem')

    const opencode = JSON.parse(await readFile(path.join(projectRoot, 'opencode.json'), 'utf8')) as {
      mcp?: Record<string, { type?: string; command?: string[] }>
    }
    expect(opencode.mcp?.filesystem?.type).toBe('local')
    expect(opencode.mcp?.filesystem?.command?.[0]).toBe('npx')

    const windsurfSkills = await lstat(path.join(projectRoot, '.windsurf', 'skills'))
    expect(windsurfSkills.isDirectory() || windsurfSkills.isSymbolicLink()).toBe(true)

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toHaveLength(0)
  })

  it('preserves non-MCP opencode settings while updating managed MCP block', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-wo-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    await writeFile(
      path.join(projectRoot, 'opencode.json'),
      JSON.stringify({
        theme: 'solarized',
        mcp: {
          legacy: {
            type: 'remote',
            url: 'https://legacy.example.com/mcp'
          }
        }
      }, null, 2),
      'utf8',
    )

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['opencode']
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const opencode = JSON.parse(await readFile(path.join(projectRoot, 'opencode.json'), 'utf8')) as {
      theme?: string
      mcp?: Record<string, unknown>
    }
    expect(opencode.theme).toBe('solarized')
    expect(Object.keys(opencode.mcp ?? {})).toContain('filesystem')
    expect(Object.keys(opencode.mcp ?? {})).not.toContain('legacy')
  })
})
