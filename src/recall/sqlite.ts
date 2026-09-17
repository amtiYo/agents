import type { PathLike } from 'node:fs'
import { chmod, copyFile as copyFileRaw, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DatabaseSync, DatabaseSyncOptions, SQLOutputValue } from 'node:sqlite'
import { ensureDir, pathExists } from '../core/fs.js'
import type { RecallFileRow, RecallProvider } from './types.js'

export const RECALL_SCHEMA_VERSION = '1'

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL,
  turn_count INTEGER NOT NULL DEFAULT 0,
  redacted_count INTEGER NOT NULL DEFAULT 0,
  skipped TEXT
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  role TEXT NOT NULL,
  ts_ms INTEGER,
  project TEXT,
  quote TEXT NOT NULL,
  tools_json TEXT NOT NULL DEFAULT '[]',
  paths_json TEXT NOT NULL DEFAULT '[]',
  tools_text TEXT NOT NULL DEFAULT '',
  paths_text TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL,
  source_line INTEGER,
  source_key TEXT,
  UNIQUE(file_id, session_id, turn)
);

CREATE INDEX IF NOT EXISTS turns_session ON turns(session_id, turn);
CREATE INDEX IF NOT EXISTS turns_project ON turns(project);
CREATE INDEX IF NOT EXISTS turns_provider ON turns(provider);

CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
  quote,
  tools_text,
  paths_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
`

interface LoadedSqlite {
  DatabaseSync: new (path: PathLike, options?: DatabaseSyncOptions) => DatabaseSync
}

let sqliteModule: LoadedSqlite | undefined

/** Whether this Node build exposes `node:sqlite` (Node 22+). */
export function recallSqliteSupported(): boolean {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  return Number.isFinite(major) && major >= 22
}

export async function loadSqlite(): Promise<LoadedSqlite> {
  if (sqliteModule) return sqliteModule
  try {
    sqliteModule = await import('node:sqlite')
    return sqliteModule
  } catch {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }
}

export function sqlString(value: SQLOutputValue | undefined): string | null {
  if (typeof value === 'string') return value
  if (value == null) return null
  return String(value)
}

export function sqlNumber(value: SQLOutputValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function sqliteOpenOptions(readOnly: boolean): { readOnly?: boolean; enableForeignKeyConstraints: boolean; timeout?: number } {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  const options: { readOnly?: boolean; enableForeignKeyConstraints: boolean; timeout?: number } = {
    enableForeignKeyConstraints: true
  }
  if (readOnly) options.readOnly = true
  if (major >= 24) options.timeout = 5_000
  return options
}

export async function openRecallDatabase(indexPath: string): Promise<DatabaseSync> {
  const sqlite = await loadSqlite()
  await ensureDir(path.dirname(indexPath))
  const db = new sqlite.DatabaseSync(indexPath, sqliteOpenOptions(false))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  const existing = sqlString(db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')?.value)
  if (existing !== RECALL_SCHEMA_VERSION) {
    db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'schema_version',
      RECALL_SCHEMA_VERSION
    )
  }
  try {
    await chmod(indexPath, 0o600)
  } catch {
    // Best-effort private mode; some filesystems ignore chmod.
  }
  return db
}

export async function openSqliteRead(filePath: string): Promise<{ db: DatabaseSync; cleanup: () => Promise<void> }> {
  const sqlite = await loadSqlite()
  try {
    const db = new sqlite.DatabaseSync(filePath, sqliteOpenOptions(true))
    db.prepare('SELECT 1').get()
    return {
      db,
      cleanup: async () => {
        db.close()
      }
    }
  } catch {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'agents-recall-sqlite-'))
    const copyPath = path.join(tmp, 'copy.db')
    await copyFileRaw(filePath, copyPath)
    for (const suffix of ['-wal', '-shm']) {
      const side = `${filePath}${suffix}`
      if (await pathExists(side)) {
        await copyFileRaw(side, `${copyPath}${suffix}`)
      }
    }
    const db = new sqlite.DatabaseSync(copyPath, sqliteOpenOptions(true))
    return {
      db,
      cleanup: async () => {
        db.close()
        await rm(tmp, { recursive: true, force: true })
      }
    }
  }
}

export function listTables(db: DatabaseSync): Set<string> {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`).all()
  return new Set(rows.map((row) => sqlString(row.name)).filter((name): name is string => Boolean(name)))
}

export function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) return false
  const rows = db.prepare(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => sqlString(row.name) === column)
}

export function isWalEnabled(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA journal_mode').get()
  const mode = sqlString(row?.journal_mode ?? row?.['journal_mode'])
  return (mode ?? '').toLowerCase() === 'wal'
}

export function getFileRow(db: DatabaseSync, filePath: string): RecallFileRow | null {
  const row = db.prepare('SELECT * FROM files WHERE path = ?').get(filePath)
  if (!row) return null
  return {
    id: sqlNumber(row.id) ?? 0,
    path: sqlString(row.path) ?? filePath,
    provider: (sqlString(row.provider) ?? 'claude') as RecallProvider,
    mtimeMs: sqlNumber(row.mtime_ms) ?? 0,
    size: sqlNumber(row.size) ?? 0,
    turnCount: sqlNumber(row.turn_count) ?? 0,
    redactedCount: sqlNumber(row.redacted_count) ?? 0,
    skipped: sqlString(row.skipped)
  }
}

export function upsertFileRow(
  db: DatabaseSync,
  input: {
    path: string
    provider: RecallProvider
    mtimeMs: number
    size: number
    turnCount: number
    redactedCount: number
    skipped: string | null
  }
): number {
  db.prepare(
    `INSERT INTO files(path, provider, mtime_ms, size, turn_count, redacted_count, skipped)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       provider = excluded.provider,
       mtime_ms = excluded.mtime_ms,
       size = excluded.size,
       turn_count = excluded.turn_count,
       redacted_count = excluded.redacted_count,
       skipped = excluded.skipped`
  ).run(input.path, input.provider, input.mtimeMs, input.size, input.turnCount, input.redactedCount, input.skipped)
  const row = db.prepare('SELECT id FROM files WHERE path = ?').get(input.path)
  return sqlNumber(row?.id) ?? 0
}

export function deleteFileTurns(db: DatabaseSync, fileId: number): void {
  db.prepare(
    `DELETE FROM turns_fts WHERE rowid IN (SELECT id FROM turns WHERE file_id = ?)`
  ).run(fileId)
  db.prepare('DELETE FROM turns WHERE file_id = ?').run(fileId)
}

export function deleteFileRow(db: DatabaseSync, filePath: string): void {
  const row = getFileRow(db, filePath)
  if (!row) return
  deleteFileTurns(db, row.id)
  db.prepare('DELETE FROM files WHERE id = ?').run(row.id)
}

export function listIndexedFiles(db: DatabaseSync): Array<{ path: string; provider: RecallProvider }> {
  return db
    .prepare('SELECT path, provider FROM files')
    .all()
    .flatMap((row) => {
      const filePath = sqlString(row.path)
      const provider = sqlString(row.provider) as RecallProvider | null
      if (!filePath || !provider) return []
      return [{ path: filePath, provider }]
    })
}

export function listIndexedPaths(db: DatabaseSync): string[] {
  return listIndexedFiles(db).map((row) => row.path)
}

export interface TurnInsert {
  fileId: number
  provider: RecallProvider
  sessionId: string
  turn: number
  role: string
  tsMs: number | null
  project: string | null
  quote: string
  tools: string[]
  paths: string[]
  sourceKind: string
  sourceLine: number | null
  sourceKey: string | null
}

export function insertTurn(db: DatabaseSync, turn: TurnInsert): number {
  const toolsJson = JSON.stringify(turn.tools)
  const pathsJson = JSON.stringify(turn.paths)
  const toolsText = turn.tools.join(' ')
  const pathsText = turn.paths.join(' ')
  const result = db.prepare(
    `INSERT INTO turns(
      file_id, provider, session_id, turn, role, ts_ms, project, quote,
      tools_json, paths_json, tools_text, paths_text, source_kind, source_line, source_key
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    turn.fileId,
    turn.provider,
    turn.sessionId,
    turn.turn,
    turn.role,
    turn.tsMs,
    turn.project,
    turn.quote,
    toolsJson,
    pathsJson,
    toolsText,
    pathsText,
    turn.sourceKind,
    turn.sourceLine,
    turn.sourceKey
  )
  const id = Number(result.lastInsertRowid)
  db.prepare('INSERT INTO turns_fts(rowid, quote, tools_text, paths_text) VALUES(?, ?, ?, ?)').run(
    id,
    turn.quote,
    toolsText,
    pathsText
  )
  return id
}

export function parseStringArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}
