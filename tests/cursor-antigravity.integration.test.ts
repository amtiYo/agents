import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

describe('cursor + antigravity sync', () => {
  it('materializes cursor project config and antigravity workspace config', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['cursor', 'antigravity']
    config.integrations.options.cursorAutoApprove = false
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const cursorMcp = JSON.parse(await readFile(path.join(projectRoot, '.cursor', 'mcp.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys((cursorMcp.mcpServers as Record<string, unknown>) ?? {})).toContain('filesystem')

    const antigravityMcp = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'mcp_config.json'), 'utf8'),
    ) as Record<string, unknown>
    const workspaceServerNames = Object.keys((antigravityMcp.mcpServers as Record<string, unknown>) ?? {})
    expect(workspaceServerNames).toContain('filesystem')

    const generatedAntigravity = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'antigravity.mcp_config.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(generatedAntigravity).toEqual(antigravityMcp)
    await expect(lstat(path.join(projectRoot, '.antigravity', 'mcp.json'))).rejects.toThrow()
    await expect(lstat(path.join(projectRoot, '.gemini', 'skills'))).rejects.toThrow()
  }, 15000)

  it('removes only project-managed antigravity workspace entries when MCP sync is disabled', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-ca-'))
    const workspacePath = path.join(projectRoot, '.agents', 'mcp_config.json')
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    config.integrations.options.antigravityGlobalSync = true
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })
    await expect(stat(workspacePath)).resolves.toBeTruthy()

    const synced = JSON.parse(await readFile(workspacePath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    await writeFile(
      workspacePath,
      JSON.stringify({
        theme: 'dark',
        mcpServers: {
          manual: {
            command: 'manual-server'
          },
          ...(synced.mcpServers ?? {})
        }
      }, null, 2),
      'utf8',
    )

    const disabled = await loadAgentsConfig(projectRoot)
    disabled.integrations.options.antigravityGlobalSync = false
    await saveAgentsConfig(projectRoot, disabled)

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toContain('.agents/mcp_config.json')

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })
    const cleaned = JSON.parse(await readFile(workspacePath, 'utf8')) as {
      theme?: string
      mcpServers?: Record<string, unknown>
    }
    expect(cleaned.theme).toBe('dark')
    expect(Object.keys(cleaned.mcpServers ?? {})).toEqual(['manual'])

    const generatedAntigravity = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'generated', 'antigravity.mcp_config.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.keys((generatedAntigravity.mcpServers as Record<string, unknown>) ?? {})).not.toHaveLength(0)
  })
})
