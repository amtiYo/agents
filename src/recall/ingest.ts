import { adapterById } from './adapters/index.js'
import { clipQuote, clipSpeech, uniqueStrings } from './speech.js'
import { redactSecrets } from './redact.js'
import { getHomeDir } from '../core/paths.js'
import { getRecallIndexPath, normalizeProjectPath } from './paths.js'
import {
  deleteFileRow,
  deleteFileTurns,
  insertTurn,
  listIndexedFiles,
  openRecallDatabase,
  recallSqliteSupported,
  sqlNumber,
  upsertFileRow
} from './sqlite.js'
import { RECALL_PROVIDERS } from './types.js'
import type { RecallAdapter, RecallIngestOptions, RecallIngestResult, RecallParsedTurn, RecallProvider } from './types.js'
import { statFile } from './walk.js'

export function groupTurns(turns: RecallParsedTurn[]): Map<string, RecallParsedTurn[]> {
  const grouped = new Map<string, RecallParsedTurn[]>()
  for (const turn of turns) {
    const list = grouped.get(turn.sessionId) ?? []
    list.push(turn)
    grouped.set(turn.sessionId, list)
  }
  return grouped
}

/** Speech turns in the same order ingest assigns 1-based `turn` numbers. */
export function indexedSessionTurns(turns: RecallParsedTurn[], sessionId: string): RecallParsedTurn[] {
  const sessionTurns = groupTurns(turns).get(sessionId) ?? []
  return sessionTurns.filter((turn) => turn.text.trim().length > 0)
}

async function ingestPath(
  adapter: RecallAdapter,
  filePath: string,
  options: {
    homeDir: string
    env: NodeJS.ProcessEnv
    force: boolean
    result: RecallIngestResult
    db: Awaited<ReturnType<typeof openRecallDatabase>>
  }
): Promise<void> {
  const info = await statFile(filePath)
  if (!info) return
  options.result.filesSeen += 1

  const existing = options.db.prepare('SELECT id, mtime_ms, size FROM files WHERE path = ?').get(filePath)
  if (
    !options.force &&
    existing &&
    sqlNumber(existing.mtime_ms) === info.mtimeMs &&
    sqlNumber(existing.size) === info.size
  ) {
    options.result.filesUnchanged += 1
    return
  }

  let parsed
  try {
    parsed = await adapter.parse(filePath, options.homeDir, options.env)
  } catch (error) {
    options.result.errors.push({
      path: filePath,
      message: error instanceof Error ? error.message : String(error)
    })
    return
  }

  if (parsed.skipped === 'subagent') {
    const fileId = upsertFileRow(options.db, {
      path: filePath,
      provider: adapter.id,
      mtimeMs: info.mtimeMs,
      size: info.size,
      turnCount: 0,
      redactedCount: 0,
      skipped: 'subagent'
    })
    deleteFileTurns(options.db, fileId)
    options.result.skippedSubagents += 1
    options.result.filesIndexed += 1
    return
  }

  let redacted = 0
  const fileId = upsertFileRow(options.db, {
    path: filePath,
    provider: adapter.id,
    mtimeMs: info.mtimeMs,
    size: info.size,
    turnCount: 0,
    redactedCount: 0,
    skipped: parsed.skipped
  })
  deleteFileTurns(options.db, fileId)

  let turnCount = 0
  for (const [, sessionTurns] of groupTurns(parsed.turns)) {
    let turnNo = 0
    for (const turn of sessionTurns) {
      const clipped = clipSpeech(turn.text)
      const redactedSpeech = redactSecrets(clipped)
      redacted += redactedSpeech.count
      const quote = clipQuote(redactedSpeech.text)
      if (!quote) continue
      turnNo += 1
      insertTurn(options.db, {
        fileId,
        provider: adapter.id,
        sessionId: turn.sessionId,
        turn: turnNo,
        role: turn.role,
        tsMs: turn.timestampMs,
        project: normalizeProjectPath(turn.project),
        quote,
        tools: uniqueStrings(turn.tools),
        paths: uniqueStrings(turn.paths),
        sourceKind: turn.sourceKind,
        sourceLine: turn.sourceLine,
        sourceKey: turn.sourceKey
      })
      turnCount += 1
    }
  }

  upsertFileRow(options.db, {
    path: filePath,
    provider: adapter.id,
    mtimeMs: info.mtimeMs,
    size: info.size,
    turnCount,
    redactedCount: redacted,
    skipped: turnCount === 0 ? parsed.skipped ?? 'empty' : null
  })

  options.result.filesIndexed += 1
  options.result.turnsIndexed += turnCount
  options.result.redacted += redacted
}

/**
 * Scan provider stores and write speech turns into the SQLite FTS5 index.
 *
 * Unchanged files (same mtime + size) are skipped. Missing files are dropped
 * from the index. Does not walk the user's real home unless the caller points
 * `homeDir` / env at it.
 */
export async function ingest(options: RecallIngestOptions = {}): Promise<RecallIngestResult> {
  if (!recallSqliteSupported()) {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }

  const homeDir = options.homeDir ?? getHomeDir()
  const env = options.env ?? process.env
  const indexPath = options.indexPath ?? getRecallIndexPath(homeDir)
  const providers: RecallProvider[] = options.providers ?? [...RECALL_PROVIDERS]
  const force = options.force === true
  const result: RecallIngestResult = {
    filesSeen: 0,
    filesIndexed: 0,
    filesUnchanged: 0,
    filesRemoved: 0,
    turnsIndexed: 0,
    redacted: 0,
    skippedSubagents: 0,
    errors: []
  }

  const db = await openRecallDatabase(indexPath)
  const seen = new Set<string>()

  try {
    db.exec('BEGIN')
    for (const id of providers) {
      const adapter = adapterById(id)
      let files: string[] = []
      try {
        files = await adapter.discover(homeDir, env)
      } catch (error) {
        result.errors.push({
          path: id,
          message: error instanceof Error ? error.message : String(error)
        })
        continue
      }
      for (const filePath of files) {
        if (seen.has(filePath)) continue
        seen.add(filePath)
        await ingestPath(adapter, filePath, { homeDir, env, force, result, db })
      }
    }

    for (const indexed of listIndexedFiles(db)) {
      if (!providers.includes(indexed.provider)) continue
      if (seen.has(indexed.path)) continue
      deleteFileRow(db, indexed.path)
      result.filesRemoved += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }

  return result
}

/** Rebuild every discovered file, ignoring mtime+size. */
export async function reindex(options: RecallIngestOptions = {}): Promise<RecallIngestResult> {
  return ingest({ ...options, force: true })
}
