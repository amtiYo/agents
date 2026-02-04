import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, lstat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runConnect } from '../src/commands/connect.js'
import { performSync } from '../src/core/sync.js'

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

describe('init + connect + sync', () => {
  it('creates .agents scaffold and materializes tool configs', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-proj-'))

    try {
      await runInit({ projectRoot, force: false })
      await runConnect({
        projectRoot,
        ai: 'codex,gemini,copilot_vscode',
        interactive: false,
        verbose: false
      })

      expect(await exists(path.join(projectRoot, '.agents', 'config.json'))).toBe(true)
      expect(await exists(path.join(projectRoot, '.codex', 'config.toml'))).toBe(true)
      expect(await exists(path.join(projectRoot, '.gemini', 'settings.json'))).toBe(true)
      expect(await exists(path.join(projectRoot, '.vscode', 'mcp.json'))).toBe(true)

      const rootAgents = path.join(projectRoot, 'AGENTS.md')
      expect(await exists(rootAgents)).toBe(true)

      const geminiSettings = JSON.parse(await readFile(path.join(projectRoot, '.gemini', 'settings.json'), 'utf8'))
      expect(geminiSettings.context?.fileName).toBe('AGENTS.md')
      expect(geminiSettings.mcpServers).toBeTypeOf('object')

      const codexConfig = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
      expect(codexConfig).toContain('[mcp_servers."filesystem"]')
      expect(codexConfig).not.toContain('context7')

      const check = await performSync({ projectRoot, check: true, verbose: false })
      expect(check.changed).toHaveLength(0)
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
})
