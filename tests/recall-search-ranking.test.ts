import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { search } from '../src/recall/search.js'
import { insertTurn, openRecallDatabase, recallSqliteSupported, upsertFileRow } from '../src/recall/sqlite.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function seed(rows: Array<{ project: string; quote: string }>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agents-recall-ranking-'))
  tempDirs.push(root)
  const indexPath = path.join(root, 'index.sqlite')
  const db = await openRecallDatabase(indexPath)
  try {
    const fileId = upsertFileRow(db, { path: path.join(root, 'transcript'), provider: 'claude', mtimeMs: 0, size: 0, turnCount: rows.length, redactedCount: 0, skipped: null })
    rows.forEach((row, i) => insertTurn(db, {
      fileId, provider: 'claude', sessionId: String(i), turn: 1, role: 'user', tsMs: Date.now(),
      project: row.project, quote: row.quote, tools: [], paths: [], sourceKind: 'jsonl', sourceLine: i, sourceKey: null
    }))
  } finally {
    db.close()
  }
  return indexPath
}

const describeRecall = recallSqliteSupported() ? describe : describe.skip
describeRecall('recall candidate selection', () => {
  it('filters to the requested project before limiting candidates', async () => {
    const wanted = path.resolve('/work/repo_%')
    const indexPath = await seed([
      ...Array.from({ length: 40 }, () => ({ project: path.resolve('/work/repo_AA'), quote: 'needle elsewhere' })),
      { project: wanted, quote: 'needle in selected project' },
      { project: path.join(wanted, 'nested'), quote: 'needle in nested directory' }
    ])
    const hits = await search('needle', { indexPath, project: wanted, limit: 2 })
    expect(hits.map(hit => hit.project).sort()).toEqual([wanted, path.join(wanted, 'nested')].sort())
    const fromChild = await search('needle', { indexPath, project: path.join(wanted, 'nested'), limit: 2 })
    expect(fromChild).toHaveLength(2)
  })

  it('selects the best text matches before applying the candidate limit', async () => {
    const project = path.resolve('/work/repo')
    const indexPath = await seed([
      ...Array.from({ length: 40 }, () => ({ project, quote: 'needle ' + 'filler '.repeat(50) })),
      { project, quote: 'needle' }
    ])
    const hits = await search('needle', { indexPath, all: true, limit: 1 })
    expect(hits[0]?.quote).toBe('needle')
  })
})
