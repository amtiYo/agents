import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { project } from '../src/recall/shelves.js'
import { insertTurn, openRecallDatabase, recallSqliteSupported, upsertFileRow } from '../src/recall/sqlite.js'

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const describeRecall = recallSqliteSupported() ? describe : describe.skip
describeRecall('Russian recall decisions', () => {
  it.each([
    ['user', 'Мы решили использовать SQLite для локального индекса.', true],
    ['user', 'Решили что конфиги остаются в репозитории.', true],
    ['user', 'Остановились на TypeScript для реализации CLI.', true],
    ['user', 'Договорились проверять сборку перед коммитом.', true],
    ['assistant', 'Как обсуждали: мы решили использовать SQLite для индекса.', true],
    ['user', 'Перерешили прежний вопрос после обсуждения.', false],
    ['user', 'Решились на большое путешествие вместе.', false]
  ] as const)('recognizes %s: %s', async (role, quote, expected) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-recall-russian-'))
    tempDirs.push(root)
    const indexPath = path.join(root, 'index.sqlite')
    const db = await openRecallDatabase(indexPath)
    try {
      const fileId = upsertFileRow(db, { path: path.join(root, 'transcript'), provider: 'claude', mtimeMs: 0, size: 0, turnCount: 1, redactedCount: 0, skipped: null })
      insertTurn(db, {
        fileId, provider: 'claude', sessionId: 'session', turn: 1, role, tsMs: Date.now(),
        project: root, quote, tools: [], paths: [], sourceKind: 'jsonl', sourceLine: 1, sourceKey: null
      })
    } finally {
      db.close()
    }
    const card = await project({ indexPath, homeDir: root, cwd: root, env: {} })
    expect(card.decisions.length).toBe(expected ? 1 : 0)
    if (expected) expect(card.decisions[0]?.citations[0]?.quote).toBe(quote)
  })
})
