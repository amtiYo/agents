import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildContributingAgentsBlock,
  buildReadmeAgentsBlock,
  syncProjectDocsSections,
  upsertManagedAgentsDocsSection
} from '../src/core/projectDocs.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('project docs sync', () => {
  it('upserts managed block and stays idempotent', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-project-docs-'))
    tempDirs.push(projectRoot)

    await writeFile(path.join(projectRoot, 'README.md'), '# Demo\n', 'utf8')
    await writeFile(path.join(projectRoot, 'CONTRIBUTING.md'), '# Contributing\n', 'utf8')

    const first = await syncProjectDocsSections({
      projectRoot,
      includeContributing: true
    })
    expect(first.changed.sort()).toEqual(['CONTRIBUTING.md', 'README.md'])
    expect(first.skipped).toEqual([])

    const second = await syncProjectDocsSections({
      projectRoot,
      includeContributing: true
    })
    expect(second.changed).toEqual([])
    expect(second.skipped).toEqual([])

    const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
    const contributing = await readFile(path.join(projectRoot, 'CONTRIBUTING.md'), 'utf8')
    expect(readme).toContain('<!-- agents:project-docs:start -->')
    expect(contributing).toContain('<!-- agents:project-docs:start -->')
  })

  it('updates README only and reports skipped CONTRIBUTING when missing', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-project-docs-skip-'))
    tempDirs.push(projectRoot)

    await writeFile(path.join(projectRoot, 'README.md'), '# Demo\n', 'utf8')

    const result = await syncProjectDocsSections({
      projectRoot,
      includeContributing: true
    })

    expect(result.changed).toEqual(['README.md'])
    expect(result.skipped).toEqual(['CONTRIBUTING.md'])
  })

  it('replaces only managed block and preserves user content', () => {
    const original = [
      '# Header',
      '',
      'Keep this intro.',
      '',
      buildReadmeAgentsBlock(),
      '',
      'Keep this footer.',
      ''
    ].join('\n')
    const updated = upsertManagedAgentsDocsSection(original, buildContributingAgentsBlock())

    expect(updated).toContain('# Header')
    expect(updated).toContain('Keep this intro.')
    expect(updated).toContain('Keep this footer.')
    expect(updated).toContain('## agents workflow note')
  })
})
