import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ingest, search } from '../src/recall/index.js'
import { openRecallDatabase, recallSqliteSupported } from '../src/recall/sqlite.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'agents-recall-fulltext-'))
  tempDirs.push(home)
  const transcript = path.join(home, '.claude/projects/project/session.jsonl')
  await mkdir(path.dirname(transcript), { recursive: true })
  const secret = 'sensitive-value-123456789'
  const text = 'Introduction and background. '.repeat(50) + 'needleafterexcerpt ' + JSON.stringify({ token: secret })
  await writeFile(transcript, JSON.stringify({ type: 'user', sessionId: 'session', cwd: home, message: { content: text } }) + '\n')
  return { homeDir: home, indexPath: path.join(home, 'index.sqlite'), env: {}, providers: ['claude'] as const, secret }
}

const describeRecall = recallSqliteSupported() ? describe : describe.skip
describeRecall('recall full speech index', () => {
  it('finds text beyond the short quote without persisting secrets', async () => {
    const { providers, secret, ...options } = await fixture()
    await ingest({ ...options, providers: [...providers] })
    const hits = await search('needleafterexcerpt', { indexPath: options.indexPath, all: true })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.quote).toContain('needleafterexcerpt')
    expect(hits[0]!.quote.length).toBeLessThanOrEqual(500)
    const db = await openRecallDatabase(options.indexPath)
    try {
      expect(String(db.prepare('SELECT quote FROM turns').get()?.quote).length).toBeLessThanOrEqual(500)
      const searchable = String(db.prepare('SELECT quote FROM turns_fts').get()?.quote)
      expect(searchable).toContain('needleafterexcerpt')
      expect(searchable).not.toContain(secret)
      expect(searchable).toContain('[redacted]')
    } finally {
      db.close()
    }
  })

  it('reindexes unchanged transcripts when upgrading an excerpt-only index', async () => {
    const { providers, secret: _secret, ...options } = await fixture()
    const ingestOptions = { ...options, providers: [...providers] }
    await ingest(ingestOptions)
    const db = await openRecallDatabase(options.indexPath)
    try {
      db.exec('DELETE FROM turns_fts; INSERT INTO turns_fts(rowid, quote, tools_text, paths_text) SELECT id, quote, tools_text, paths_text FROM turns')
      db.prepare("UPDATE meta SET value = '1' WHERE key = 'schema_version'").run()
    } finally {
      db.close()
    }
    const result = await ingest(ingestOptions)
    expect(result.filesIndexed).toBe(1)
    expect(await search('needleafterexcerpt', { indexPath: options.indexPath, all: true })).toHaveLength(1)
    expect((await ingest(ingestOptions)).filesUnchanged).toBe(1)
  })
})
