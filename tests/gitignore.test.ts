import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { cleanupManagedGitignore, ensureProjectGitignore } from '../src/core/gitignore.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('gitignore management', () => {
  it('removes source-only managed entries when sync mode switches to commit-generated', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-gitignore-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    await writeFile(path.join(projectRoot, '.gitignore'), '.custom\nCLAUDE.md\n', 'utf8')

    const config = await loadAgentsConfig(projectRoot)
    config.syncMode = 'commit-generated'
    await saveAgentsConfig(projectRoot, config)

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.custom')
    expect(gitignore).toContain('.agents/local.json')
    expect(gitignore).toContain('.agents/generated/')
    expect(gitignore).not.toContain('CLAUDE.md')
    expect(gitignore).not.toContain('.codex/')
    expect(gitignore).not.toContain('.gemini/')
  })

  it('does not duplicate managed entries when existing lines use a leading slash', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-gitignore-'))
    tempDirs.push(projectRoot)

    await writeFile(path.join(projectRoot, '.gitignore'), '/CLAUDE.md\n/.agents/generated/\n.custom\n', 'utf8')

    const changed = await ensureProjectGitignore(projectRoot, 'source-only')
    expect(changed).toBe(true)

    const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
    expect((gitignore.match(/CLAUDE\.md/g) ?? []).length).toBe(1)
    expect((gitignore.match(/\.agents\/generated\//g) ?? []).length).toBe(1)
    expect(gitignore).toContain('.custom')
  })

  it('cleanup removes managed entries and keeps user entries', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-gitignore-'))
    tempDirs.push(projectRoot)

    await writeFile(
      path.join(projectRoot, '.gitignore'),
      '.custom\n/CLAUDE.md\n/.agents/local.json\n/.agents/generated/\n/.codex/\n',
      'utf8'
    )

    const changed = await cleanupManagedGitignore(projectRoot)
    expect(changed).toBe(true)

    const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
    expect(gitignore.trim()).toBe('.custom')
  })

  it('cleanup removes gitignore file when it only contains managed entries', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-gitignore-'))
    tempDirs.push(projectRoot)

    const gitignorePath = path.join(projectRoot, '.gitignore')
    await writeFile(gitignorePath, '.agents/local.json\n/.agents/generated/\nCLAUDE.md\n', 'utf8')

    const changed = await cleanupManagedGitignore(projectRoot)
    expect(changed).toBe(true)
    await expect(readFile(gitignorePath, 'utf8')).rejects.toThrow()
  })
})
