import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ingest, search } from '../src/recall/index.js'
import { recallSqliteSupported } from '../src/recall/sqlite.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const describeRecall = recallSqliteSupported() ? describe : describe.skip
describeRecall('recall live SQLite stores', () => {
  it.each(['cursor', 'opencode'] as const)('detects committed %s WAL writes while the main file stays unchanged', async provider => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'agents-recall-wal-'))
    tempDirs.push(home)
    const indexPath = path.join(home, 'index.sqlite')
    const filePath = provider === 'cursor'
      ? path.join(home, 'state.vscdb')
      : path.join(home, '.local/share/opencode/opencode.db')
    await mkdir(path.dirname(filePath), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite')
    const store = new DatabaseSync(filePath)
    try {
      store.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
      if (provider === 'cursor') {
        store.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)')
        store.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run('composerData:session', JSON.stringify({ composerId: 'session' }))
      } else {
        store.exec('CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT)')
      }
      const add = (id: string, text: string): void => {
        if (provider === 'cursor') {
          store.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)').run(`bubbleId:session:${id}`, JSON.stringify({ type: 1, text }))
        } else {
          store.prepare('INSERT INTO session_message VALUES (?, ?, ?)').run(id, 'session', JSON.stringify({ role: 'user', text }))
        }
      }
      add('one', 'originalword')
      store.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const options = { homeDir: home, indexPath, providers: [provider], env: { CURSOR_STATE_DB_PATH: filePath } }
      await ingest(options)
      const before = await stat(filePath)
      add('two', 'walonlyword')
      const after = await stat(filePath)
      expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs])
      const result = await ingest(options)
      expect(result.errors).toEqual([])
      expect(await search('walonlyword', { indexPath, all: true })).toHaveLength(1)
      // Repeated scans replace turns instead of duplicating them.
      await ingest(options)
      expect(await search('walonlyword', { indexPath, all: true })).toHaveLength(1)
    } finally {
      store.close()
    }
  })
})
