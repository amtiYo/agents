import type { SQLOutputValue } from 'node:sqlite'
import { getHomeDir } from '../core/paths.js'
import { adapterById } from './adapters/index.js'
import { indexedSessionTurns } from './ingest.js'
import { getRecallIndexPath, normalizeProjectPath, projectMatches } from './paths.js'
import { redactSecrets } from './redact.js'
import { clipQuote, clipSpeech, isoFromMs } from './speech.js'
import {
  isWalEnabled,
  openRecallDatabase,
  parseStringArray,
  recallSqliteSupported,
  sqlNumber,
  sqlString
} from './sqlite.js'
import { RECALL_PROVIDERS } from './types.js'
import type {
  RecallDoctorOptions,
  RecallDoctorStats,
  RecallGetOptions,
  RecallHit,
  RecallProvider,
  RecallSearchOptions,
  RecallTurn
} from './types.js'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 50
const CANDIDATE_MULTIPLIER = 6

function escapeFtsToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  const escaped = trimmed.replace(/"/g, '""')
  if (/[^A-Za-z0-9]/.test(trimmed)) return `"${escaped}"`
  return escaped
}

/** Turn a user query into an FTS5 MATCH expression. */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw.trim().split(/\s+/).map(escapeFtsToken).filter((token) => token.length > 0)
  if (tokens.length === 0) return null
  return tokens.join(' AND ')
}

function identifierTokens(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Z]/.test(token) || /[A-Za-z]+-\d+/.test(token) || token.includes('_'))
}

function recencyBoost(tsMs: number | null, now: number): number {
  if (tsMs == null) return 0.55
  const ageDays = Math.max(0, (now - tsMs) / 86_400_000)
  return 1 / (1 + ageDays / 45)
}

/** Keep the first match visible even when the FTS snippet exceeds the quote budget. */
function matchingQuote(snippet: string): string {
  const collapsed = snippet.replace(/\s+/g, ' ').trim()
  const match = collapsed.indexOf('\u0001')
  const start = Math.max(0, match - 120)
  const plain = collapsed.replace(/[\u0001\u0002]/g, '')
  return clipQuote((start > 0 ? '…' : '') + plain.slice(start))
}

function rowToHit(row: Record<string, SQLOutputValue>): RecallHit {
  return {
    provider: (sqlString(row.provider) ?? 'claude') as RecallProvider,
    sessionId: sqlString(row.session_id) ?? '',
    turn: sqlNumber(row.turn) ?? 0,
    role: sqlString(row.role) === 'user' ? 'user' : 'assistant',
    timestamp: isoFromMs(sqlNumber(row.ts_ms)),
    project: sqlString(row.project),
    quote: matchingQuote(sqlString(row.matched_quote) ?? sqlString(row.quote) ?? ''),
    tools: parseStringArray(sqlString(row.tools_json)),
    paths: parseStringArray(sqlString(row.paths_json))
  }
}

/**
 * Search indexed speech. Default scope is the current project; pass `{ all: true }`
 * for a machine-wide search.
 */
export async function search(query: string, options: RecallSearchOptions = {}): Promise<RecallHit[]> {
  if (!recallSqliteSupported()) {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }
  const match = toFtsQuery(query)
  if (!match) return []

  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cwd = options.cwd ?? process.cwd()
  const projectFilter = options.all ? null : normalizeProjectPath(options.project ?? cwd)
  const indexPath = options.indexPath ?? getRecallIndexPath(getHomeDir())
  const db = await openRecallDatabase(indexPath)
  const now = Date.now()
  const idents = identifierTokens(query)

  try {
    if (projectFilter) {
      db.function('recall_project_matches', { deterministic: true }, (stored) =>
        projectMatches(sqlString(stored), projectFilter) ? 1 : 0)
    }
    const rows = db.prepare(
      `SELECT t.*, bm25(turns_fts) AS rank,
              snippet(turns_fts, 0, char(1), char(2), '…', 64) AS matched_quote
       FROM turns_fts
       JOIN turns t ON t.id = turns_fts.rowid
       WHERE turns_fts MATCH ?
       ${projectFilter ? 'AND recall_project_matches(t.project) = 1' : ''}
       ORDER BY rank ASC, t.ts_ms DESC, t.id ASC
       LIMIT ?`
    ).all(match, limit * CANDIDATE_MULTIPLIER)

    const scored = rows
      .map((row) => {
        const hit = rowToHit(row)
        const rank = sqlNumber(row.rank) ?? 0
        const bm25 = -rank
        const roleBoost = hit.role === 'user' ? 1.35 : 1
        const recency = recencyBoost(sqlNumber(row.ts_ms), now)
        const quote = hit.quote
        const identBoost = idents.some((token) => quote.includes(token)) ? 1.4 : 1
        return { hit, score: bm25 * recency * roleBoost * identBoost }
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((entry) => entry.hit)

    return scored
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Re-read one turn from the original transcript. The index is only a pointer.
 */
export async function get(sessionId: string, turn: number, options: RecallGetOptions = {}): Promise<RecallTurn | null> {
  if (!recallSqliteSupported()) {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }
  if (!sessionId || !Number.isInteger(turn) || turn < 1) return null
  const homeDir = options.homeDir ?? getHomeDir()
  const env = options.env ?? process.env
  const indexPath = options.indexPath ?? getRecallIndexPath(homeDir)
  const db = await openRecallDatabase(indexPath)
  try {
    const row = db.prepare(
      `SELECT t.*, f.path AS source_path
       FROM turns t
       JOIN files f ON f.id = t.file_id
       WHERE t.session_id = ? AND t.turn = ?
       ORDER BY t.ts_ms DESC
       LIMIT 1`
    ).get(sessionId, turn)
    if (!row) return null
    const hit = rowToHit(row)
    const sourcePath = sqlString(row.source_path) ?? ''
    let live: string | null = null
    try {
      const parsed = await adapterById(hit.provider).parse(sourcePath, homeDir, env)
      const original = indexedSessionTurns(parsed.turns, sessionId)[turn - 1]
      live = original?.text ?? null
    } catch {
      live = null
    }
    const text = clipSpeech(redactSecrets(live ?? hit.quote).text)
    return {
      ...hit,
      text: text || hit.quote,
      sourcePath,
      sourceMissing: live == null
    }
  } finally {
    db.close()
  }
}

/** Index health: file/turn counts and how many secrets were redacted. */
export async function doctor(options: RecallDoctorOptions = {}): Promise<RecallDoctorStats> {
  if (!recallSqliteSupported()) {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }
  const indexPath = options.indexPath ?? getRecallIndexPath(getHomeDir())
  const db = await openRecallDatabase(indexPath)
  try {
    const files = sqlNumber(db.prepare('SELECT COUNT(*) AS n FROM files').get()?.n) ?? 0
    const turns = sqlNumber(db.prepare('SELECT COUNT(*) AS n FROM turns').get()?.n) ?? 0
    const redacted = sqlNumber(db.prepare('SELECT COALESCE(SUM(redacted_count), 0) AS n FROM files').get()?.n) ?? 0
    const skippedSubagents =
      sqlNumber(db.prepare(`SELECT COUNT(*) AS n FROM files WHERE skipped = 'subagent'`).get()?.n) ?? 0
    const providers = Object.fromEntries(
      RECALL_PROVIDERS.map((provider) => [
        provider,
        {
          files: sqlNumber(db.prepare('SELECT COUNT(*) AS n FROM files WHERE provider = ?').get(provider)?.n) ?? 0,
          turns: sqlNumber(db.prepare('SELECT COUNT(*) AS n FROM turns WHERE provider = ?').get(provider)?.n) ?? 0
        }
      ])
    ) as RecallDoctorStats['providers']

    return {
      indexPath,
      files,
      turns,
      redacted,
      skippedSubagents,
      providers,
      wal: isWalEnabled(db)
    }
  } finally {
    db.close()
  }
}

