import path from 'node:path'
import { pathExists } from '../../core/fs.js'
import { asArray, asBoolean, asRecord, asString, parseJsonObject } from '../jsonl.js'
import { normalizeProjectPath, opencodeDataDir } from '../paths.js'
import { extractSpeech, extractToolNames, extractToolPaths, isSpeechRole, parseTimestampMs } from '../speech.js'
import { listTables, openSqliteRead, sqlString, tableHasColumn } from '../sqlite.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn } from '../types.js'
import { walkFiles } from '../walk.js'

function parseMessageBlob(
  blob: string,
  sessionId: string,
  project: string | null,
  sourceKey: string
): RecallParsedTurn | null {
  const parsed = parseJsonObject(blob) ?? {}
  const message = asRecord(parsed.data) ?? parsed
  const roleRaw = asString(message.role)
  if (!isSpeechRole(roleRaw)) return null
  if (asBoolean(message.synthetic) || asBoolean(message.ignored)) return null
  const content = message.content ?? message.parts
  const text = (asString(message.text) ?? extractSpeech(content)).trim()
  if (!text) return null
  const time = asRecord(message.time)
  return {
    sessionId,
    role: roleRaw,
    timestampMs:
      parseTimestampMs(time?.created) ??
      parseTimestampMs(message.timeCreated) ??
      parseTimestampMs(message.createdAt) ??
      parseTimestampMs(message.time_created),
    project,
    text,
    tools: extractToolNames(content),
    paths: extractToolPaths(content),
    sourceKind: 'sqlite',
    sourceLine: null,
    sourceKey
  }
}

async function parseOpencodeDb(filePath: string): Promise<RecallParsedFile> {
  let handle
  try {
    handle = await openSqliteRead(filePath)
  } catch {
    return { provider: 'opencode', path: filePath, skipped: 'empty', turns: [] }
  }

  try {
    const tables = listTables(handle.db)
    const turns: RecallParsedTurn[] = []

    if (tables.has('session_message')) {
      const hasV2 = tables.has('session_v2')
      const sql = hasV2
        ? `SELECT sm.id AS id, sm.data AS data, sm.session_id AS session_id, sv2.directory AS directory
           FROM session_message sm LEFT JOIN session_v2 sv2 ON sm.session_id = sv2.id`
        : `SELECT sm.id AS id, sm.data AS data, sm.session_id AS session_id, NULL AS directory FROM session_message sm`
      for (const row of handle.db.prepare(sql).all()) {
        const sessionId = sqlString(row.session_id) ?? sqlString(row.id)
        if (!sessionId) continue
        const blob = sqlString(row.data)
        if (!blob) continue
        const turn = parseMessageBlob(blob, sessionId, normalizeProjectPath(sqlString(row.directory)), sqlString(row.id) ?? sessionId)
        if (turn) turns.push(turn)
      }
    }

    if (tables.has('session') && tables.has('message') && tables.has('part')) {
      const hasSessionId = tableHasColumn(handle.db, 'message', 'session_id')
      const exclusion =
        tables.has('session_message') && hasSessionId
          ? 'AND m.session_id NOT IN (SELECT session_id FROM session_message)'
          : ''
      const sql = `
        SELECT s.id AS session_id, s.directory AS directory, m.id AS message_id, m.data AS message_data,
               p.id AS part_id, p.data AS part_data
        FROM session s
        JOIN message m ON m.session_id = s.id
        JOIN part p ON p.message_id = m.id
        WHERE instr(substr(p.data, 1, 120), '"type":"text"') > 0
        ${exclusion}
        ORDER BY s.id, m.id, p.id
      `
      const grouped = new Map<string, RecallParsedTurn>()
      for (const row of handle.db.prepare(sql).all()) {
        const sessionId = sqlString(row.session_id)
        const partData = parseJsonObject(sqlString(row.part_data) ?? '') ?? {}
        if (asString(partData.type) !== 'text') continue
        if (asBoolean(partData.synthetic) || asBoolean(partData.ignored)) continue
        const text = asString(partData.text)?.trim()
        if (!text || !sessionId) continue
        const message = parseJsonObject(sqlString(row.message_data) ?? '') ?? {}
        const payload = asRecord(message.data) ?? message
        const roleRaw = asString(payload.role)
        if (!isSpeechRole(roleRaw)) continue
        const key = `${sessionId}:${sqlString(row.message_id)}`
        const existing = grouped.get(key)
        if (existing) {
          existing.text = `${existing.text}\n${text}`
          continue
        }
        grouped.set(key, {
          sessionId,
          role: roleRaw,
          timestampMs: parseTimestampMs(payload.time) ?? parseTimestampMs(asRecord(payload.time)?.created),
          project: normalizeProjectPath(sqlString(row.directory)),
          text,
          tools: [],
          paths: [],
          sourceKind: 'sqlite',
          sourceLine: null,
          sourceKey: sqlString(row.part_id) ?? key
        })
      }
      turns.push(...grouped.values())
    }

    return {
      provider: 'opencode',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  } catch {
    return { provider: 'opencode', path: filePath, skipped: 'empty', turns: [] }
  } finally {
    await handle.cleanup()
  }
}

async function parseLegacyJson(filePath: string): Promise<RecallParsedFile> {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(filePath, 'utf8')
  const parsed = parseJsonObject(raw)
  if (!parsed) return { provider: 'opencode', path: filePath, skipped: 'empty', turns: [] }
  const message = asRecord(parsed.data) ?? parsed
  const sessionId = asString(message.sessionID) ?? asString(message.session_id) ?? path.basename(filePath, '.json')
  const roleRaw = asString(message.role)
  if (!isSpeechRole(roleRaw)) {
    return { provider: 'opencode', path: filePath, skipped: 'empty', turns: [] }
  }
  const content = message.content ?? asArray(message.parts)
  const text = extractSpeech(content).trim()
  if (!text) return { provider: 'opencode', path: filePath, skipped: 'empty', turns: [] }
  return {
    provider: 'opencode',
    path: filePath,
    skipped: null,
    turns: [
      {
        sessionId,
        role: roleRaw,
        timestampMs: parseTimestampMs(asRecord(message.time)?.created),
        project: normalizeProjectPath(asString(asRecord(message.path)?.cwd)),
        text,
        tools: extractToolNames(content),
        paths: extractToolPaths(content),
        sourceKind: 'json',
        sourceLine: null,
        sourceKey: asString(message.id)
      }
    ]
  }
}

export const opencodeAdapter: RecallAdapter = {
  id: 'opencode',

  async discover(homeDir, env) {
    const root = opencodeDataDir(homeDir, env)
    const db = path.join(root, 'opencode.db')
    if (await pathExists(db)) return [db]
    const legacy = path.join(root, 'storage', 'message')
    return walkFiles(legacy, (_filePath, name) => name.endsWith('.json'))
  },

  async parse(filePath) {
    if (filePath.endsWith('.db') || path.basename(filePath) === 'opencode.db') {
      return parseOpencodeDb(filePath)
    }
    return parseLegacyJson(filePath)
  }
}
