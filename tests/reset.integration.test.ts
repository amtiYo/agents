import os from 'node:os'
import path from 'node:path'
import { lstat, mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { runReset } from '../src/commands/reset.js'

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath)
    return true
  } catch {
    return false
  }
}

describe('reset command', () => {
  it('cleans local materialized files in local-only mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-local-'))

    try {
      await mkdir(path.join(projectRoot, '.agents', 'generated'), { recursive: true })
      await mkdir(path.join(projectRoot, '.codex'), { recursive: true })
      await mkdir(path.join(projectRoot, '.gemini'), { recursive: true })
      await mkdir(path.join(projectRoot, '.windsurf', 'skills'), { recursive: true })
      await mkdir(path.join(projectRoot, '.opencode', 'agent'), { recursive: true })
      await mkdir(path.join(projectRoot, '.vscode'), { recursive: true })

      await writeFile(path.join(projectRoot, '.agents', 'generated', 'x.txt'), 'x\n')
      await writeFile(path.join(projectRoot, '.codex', 'config.toml'), 'x\n')
      await writeFile(path.join(projectRoot, '.gemini', 'settings.json'), '{}\n')
      await writeFile(path.join(projectRoot, '.windsurf', 'skills', 'sample.md'), 'x\n')
      await writeFile(path.join(projectRoot, '.opencode', 'agent', 'sample.md'), 'x\n')
      await writeFile(path.join(projectRoot, 'opencode.json'), '{}\n')
      await writeFile(path.join(projectRoot, '.vscode', 'mcp.json'), '{}\n')

      await runReset({ projectRoot, localOnly: true, hard: false })

      expect(await exists(path.join(projectRoot, '.agents', 'generated'))).toBe(true)
      expect(await exists(path.join(projectRoot, '.codex'))).toBe(false)
      expect(await exists(path.join(projectRoot, '.gemini'))).toBe(false)
      expect(await exists(path.join(projectRoot, '.windsurf'))).toBe(false)
      expect(await exists(path.join(projectRoot, '.opencode'))).toBe(false)
      expect(await exists(path.join(projectRoot, 'opencode.json'))).toBe(false)
      expect(await exists(path.join(projectRoot, '.vscode', 'mcp.json'))).toBe(false)
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('hard reset removes .agents setup and managed gitignore entries', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-hard-'))

    try {
      await mkdir(path.join(projectRoot, '.agents'), { recursive: true })
      await writeFile(path.join(projectRoot, '.agents', 'agents.json'), '{}\n')
      await writeFile(path.join(projectRoot, '.agents', 'local.json'), '{}\n')
      await writeFile(path.join(projectRoot, '.gitignore'), '.agents/local.json\n.agents/generated/\n.custom\n')
      await writeFile(path.join(projectRoot, 'AGENTS.md'), 'placeholder\n')

      await runReset({ projectRoot, localOnly: false, hard: true })

      expect(await exists(path.join(projectRoot, '.agents'))).toBe(false)
      expect(await exists(path.join(projectRoot, 'AGENTS.md'))).toBe(false)

      const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
      expect(gitignore).toContain('.custom')
      expect(gitignore).not.toContain('.agents/local.json')
      expect(gitignore).not.toContain('.agents/generated/')
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('hard reset removes .vscode/settings.json only when fully managed', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-reset-vscode-'))

    try {
      await mkdir(path.join(projectRoot, '.agents', 'generated'), { recursive: true })
      await mkdir(path.join(projectRoot, '.vscode'), { recursive: true })
      await writeFile(path.join(projectRoot, '.agents', 'agents.json'), '{}\n')
      await writeFile(path.join(projectRoot, 'AGENTS.md'), 'placeholder\n')
      await writeFile(
        path.join(projectRoot, '.vscode', 'settings.json'),
        JSON.stringify(
          {
            'files.exclude': { '**/.codex': true },
            'search.exclude': { '**/.codex': true }
          },
          null,
          2,
        ),
      )
      await writeFile(
        path.join(projectRoot, '.agents', 'generated', 'vscode.settings.state.json'),
        JSON.stringify({ managedPaths: ['**/.codex'] }, null, 2),
      )

      await runReset({ projectRoot, localOnly: false, hard: true })

      expect(await exists(path.join(projectRoot, '.vscode', 'settings.json'))).toBe(false)
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
})
