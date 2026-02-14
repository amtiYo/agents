import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('init command AGENTS.md safety', () => {
  it('preserves an existing AGENTS.md even when force=true', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-init-preserve-'))
    tempDirs.push(projectRoot)

    const customContent = '# Existing Instructions\n\nKeep this content.\n'
    await writeFile(path.join(projectRoot, 'AGENTS.md'), customContent, 'utf8')

    await runInit({ projectRoot, force: true })

    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(customContent)
  })

  it('still overwrites other template files with force=true', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-init-force-'))
    tempDirs.push(projectRoot)

    const templateReadme = await readFile(path.join(process.cwd(), 'templates', 'agents', 'README.md'), 'utf8')
    const customAgentsContent = '# Do not touch AGENTS\n'

    await runInit({ projectRoot, force: true })
    await writeFile(path.join(projectRoot, '.agents', 'README.md'), 'custom readme\n', 'utf8')
    await writeFile(path.join(projectRoot, 'AGENTS.md'), customAgentsContent, 'utf8')

    await runInit({ projectRoot, force: true })

    expect(await readFile(path.join(projectRoot, '.agents', 'README.md'), 'utf8')).toBe(templateReadme)
    expect(await readFile(path.join(projectRoot, 'AGENTS.md'), 'utf8')).toBe(customAgentsContent)
  })
})
