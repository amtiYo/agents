import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runReset } from '../src/commands/reset.js'

const tempDirs: string[] = []
const configs = [
  ['.cursor/mcp.json', 'cursor.mcp.json', 'mcpServers'],
  ['.agents/mcp_config.json', 'antigravity.mcp_config.json', 'mcpServers'],
  ['.antigravity/mcp.json', 'antigravity.mcp_config.json', 'mcpServers'],
  ['.vscode/mcp.json', 'copilot.vscode.mcp.json', 'servers'],
  ['.junie/mcp/mcp.json', 'junie.mcp.json', 'mcpServers']
]

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-ownership-'))
  tempDirs.push(root)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(root, 'home'))
  return root
}

describe('reset config ownership', () => {
  it.each([true, false])('preserves unmanaged config entries (localOnly=%s)', async localOnly => {
    const projectRoot = await fixture()
    for (const [relative, , key] of configs) {
      const file = path.join(projectRoot, relative)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify({ [key]: { manual: { command: 'manual' } }, custom: true }))
    }
    await runReset({ projectRoot, localOnly, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))).toEqual({
        [key]: { manual: { command: 'manual' } }, custom: true
      })
    }
  })

  it('removes managed entries while retaining manual servers and settings', async () => {
    const projectRoot = await fixture()
    for (const [relative, generated, key] of configs) {
      const file = path.join(projectRoot, relative)
      const preview = path.join(projectRoot, '.agents/generated', generated)
      await mkdir(path.dirname(file), { recursive: true })
      await mkdir(path.dirname(preview), { recursive: true })
      await writeFile(preview, JSON.stringify({ [key]: { managed: { command: 'managed' } } }))
      await writeFile(file, JSON.stringify({ [key]: {
        managed: { command: 'managed' }, manual: { command: 'manual' }
      }, custom: true }))
    }
    await runReset({ projectRoot, localOnly: false, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))).toEqual({
        [key]: { manual: { command: 'manual' } }, custom: true
      })
    }
  })

  it('does not claim manual entries solely because their names appear in a preview', async () => {
    const projectRoot = await fixture()
    for (const [relative, generated, key] of configs) {
      const file = path.join(projectRoot, relative)
      const preview = path.join(projectRoot, '.agents/generated', generated)
      await mkdir(path.dirname(file), { recursive: true })
      await mkdir(path.dirname(preview), { recursive: true })
      await writeFile(preview, JSON.stringify({ [key]: { sameName: { command: 'preview-only' } } }))
      await writeFile(file, JSON.stringify({ [key]: { sameName: { command: 'manual' } } }))
    }
    await runReset({ projectRoot, localOnly: false, hard: false })
    for (const [relative, , key] of configs) {
      expect(JSON.parse(await readFile(path.join(projectRoot, relative), 'utf8'))[key])
        .toEqual({ sameName: { command: 'manual' } })
    }
  })

  it('uses the last applied ownership when previews have already changed', async () => {
    const projectRoot = await fixture()
    await mkdir(path.join(projectRoot, '.cursor'), { recursive: true })
    await mkdir(path.join(projectRoot, '.agents/generated'), { recursive: true })
    await writeFile(path.join(projectRoot, '.cursor/mcp.json'), JSON.stringify({ mcpServers: {
      old: { command: 'managed' }, next: { command: 'manual' }
    } }))
    await writeFile(path.join(projectRoot, '.agents/generated/cursor.mcp.json'), JSON.stringify({ mcpServers: {
      next: { command: 'generated' }
    } }))
    await writeFile(path.join(projectRoot, '.agents/generated/cursor.mcp.state.json'), JSON.stringify({ managedNames: ['old'] }))
    await runReset({ projectRoot, localOnly: true, hard: false })
    expect(JSON.parse(await readFile(path.join(projectRoot, '.cursor/mcp.json'), 'utf8')).mcpServers)
      .toEqual({ next: { command: 'manual' } })
  })

})
