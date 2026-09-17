import path from 'node:path'
import { pathExists } from '../../core/fs.js'
import { asNumber, asRecord, asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import {
  cursorCliHome,
  cursorStateDbPath,
  cursorUserRoot,
  normalizeProjectPath,
  pathHasDirNamed,
  resolveEncodedPath
} from '../paths.js'
import { extractSpeech, extractToolNames, extractToolPaths, normalizeRole, parseTimestampMs } from '../speech.js'
import { listTables, openSqliteRead, sqlNumber, sqlString } from '../sqlite.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn } from '../types.js'
import { walkFiles } from '../walk.js'

function filenameSessionId(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

async function projectFromCursorTranscript(filePath: string, homeDir: string): Promise<string | null> {
  let dir = path.dirname(filePath)
  while (path.basename(path.dirname(dir)) !== 'projects') {
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  const encoded = path.basename(dir)
  if (!encoded) return null
  const resolved = await resolveEncodedPath(encoded.startsWith('-') ? encoded : `-${encoded}`, homeDir)
  return normalizeProjectPath(resolved)
}

async function discoverCursorDbs(homeDir: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const files: string[] = []
  const explicit = cursorStateDbPath(homeDir, env)
  if (explicit && (await pathExists(explicit))) files.push(explicit)

  const userRoot = cursorUserRoot(homeDir, env)
  const globalDb = path.join(userRoot, 'globalStorage', 'state.vscdb')
  if (await pathExists(globalDb)) files.push(globalDb)

  const workspaceRoot = path.join(userRoot, 'workspaceStorage')
  const workspaceDbs = await walkFiles(workspaceRoot, (_filePath, name) => name === 'state.vscdb', { maxDepth: 4 })
  files.push(...workspaceDbs)
  return [...new Set(files)].sort()
}

function bubbleRole(typeValue: unknown): 'user' | 'assistant' {
  return asNumber(typeValue) === 1 ? 'user' : 'assistant'
}

async function parseCursorDb(filePath: string): Promise<RecallParsedFile> {
  let handle
  try {
    handle = await openSqliteRead(filePath)
  } catch {
    return { provider: 'cursor', path: filePath, skipped: 'empty', turns: [] }
  }

  try {
    const tables = listTables(handle.db)
    const turns: RecallParsedTurn[] = []

    if (tables.has('cursorDiskKV')) {
      const bubbles = handle.db.prepare(
        `SELECT CAST(key AS TEXT) AS key,
                json_extract(value, '$.type') AS type,
                COALESCE(json_extract(value, '$.text'), json_extract(value, '$.rawText')) AS text,
                json_extract(value, '$.timestamp') AS ts,
                json_extract(value, '$.workspaceProjectDir') AS wsdir
         FROM cursorDiskKV
         WHERE key >= 'bubbleId:' AND key < 'bubbleId;' AND value IS NOT NULL`
      ).all()

      for (const row of bubbles) {
        const key = sqlString(row.key)
        const text = sqlString(row.text)?.trim()
        if (!key || !text) continue
        const parts = key.split(':')
        if (parts.length < 3) continue
        const composerId = parts[1]
        if (!composerId) continue
        turns.push({
          sessionId: composerId,
          role: bubbleRole(sqlNumber(row.type) ?? row.type),
          timestampMs: parseTimestampMs(sqlNumber(row.ts) ?? sqlString(row.ts)),
          project: normalizeProjectPath(sqlString(row.wsdir)),
          text,
          tools: [],
          paths: [],
          sourceKind: 'sqlite',
          sourceLine: null,
          sourceKey: key
        })
      }
    } else if (tables.has('ItemTable')) {
      const rows = handle.db.prepare(
        `SELECT key, value FROM ItemTable
         WHERE typeof(value) = 'text'
           AND (key LIKE '%composerData%' OR key LIKE '%aichat%' OR key LIKE '%composerChat%')`
      ).all()
      for (const row of rows) {
        const raw = sqlString(row.value)
        if (!raw || raw.length > 1_000_000) continue
        const parsed = parseJsonObject(raw)
        if (!parsed) continue
        collectLegacyComposerTurns(parsed, sqlString(row.key), turns)
      }
    }

    return {
      provider: 'cursor',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  } catch {
    return { provider: 'cursor', path: filePath, skipped: 'empty', turns: [] }
  } finally {
    await handle.cleanup()
  }
}

function collectLegacyComposerTurns(
  value: Record<string, unknown>,
  key: string | null,
  turns: RecallParsedTurn[]
): void {
  const sessionId = asString(value.composerId) ?? asString(value.id) ?? key ?? 'cursor'
  const bubbles = Array.isArray(value.fullConversationHeadersOnly)
    ? value.fullConversationHeadersOnly
    : Array.isArray(value.conversation)
      ? value.conversation
      : Array.isArray(value.bubbles)
        ? value.bubbles
        : Array.isArray(value.messages)
          ? value.messages
          : []

  for (const [index, bubble] of bubbles.entries()) {
    const record = asRecord(bubble)
    if (!record) continue
    const text = (asString(record.text) ?? asString(record.rawText) ?? extractSpeech(record.content ?? record.message)).trim()
    if (!text) continue
    const type = record.type
    const role = asString(record.role)
    turns.push({
      sessionId,
      role: role === 'user' || asNumber(type) === 1 ? 'user' : 'assistant',
      timestampMs: parseTimestampMs(record.timestamp ?? record.createdAt),
      project: normalizeProjectPath(asString(record.workspaceProjectDir)),
      text,
      tools: [],
      paths: [],
      sourceKind: 'sqlite',
      sourceLine: null,
      sourceKey: `${key ?? sessionId}:${index}`
    })
  }
}

async function parseCursorTranscript(filePath: string, homeDir: string): Promise<RecallParsedFile> {
  if (pathHasDirNamed(filePath, 'subagents')) {
    return { provider: 'cursor', path: filePath, skipped: 'subagent', turns: [] }
  }

  const fallbackProject = await projectFromCursorTranscript(filePath, homeDir)
  const sessionId = filenameSessionId(filePath)
  const turns: RecallParsedTurn[] = []

  for await (const line of iterateJsonl(filePath)) {
    if (line.oversized || !line.text.trim()) continue
    const record = parseJsonObject(line.text)
    if (!record) continue
    const role = normalizeRole(asString(record.role) ?? asString(record.type))
    if (!role) continue
    const message = asRecord(record.message) ?? record
    const content = message.content ?? record.content ?? record.text
    const text = (typeof content === 'string' ? content : extractSpeech(content)).trim()
    if (!text) continue
    turns.push({
      sessionId,
      role,
      timestampMs: parseTimestampMs(record.timestamp) ?? parseTimestampMs(message.timestamp),
      project: fallbackProject,
      text,
      tools: extractToolNames(content),
      paths: extractToolPaths(content),
      sourceKind: 'jsonl',
      sourceLine: line.lineNo,
      sourceKey: asString(record.id) ?? asString(message.id)
    })
  }

  return {
    provider: 'cursor',
    path: filePath,
    skipped: turns.length === 0 ? 'empty' : null,
    turns
  }
}

export const cursorAdapter: RecallAdapter = {
  id: 'cursor',

  async discover(homeDir, env) {
    const files = await discoverCursorDbs(homeDir, env)
    const cliRoot = path.join(cursorCliHome(homeDir, env), 'projects')
    const transcripts = await walkFiles(
      cliRoot,
      (filePath, name) => name.endsWith('.jsonl') && pathHasDirNamed(filePath, 'agent-transcripts')
    )
    return [...files, ...transcripts].sort()
  },

  async parse(filePath, homeDir) {
    if (filePath.endsWith('.vscdb') || path.basename(filePath) === 'state.vscdb') {
      return parseCursorDb(filePath)
    }
    return parseCursorTranscript(filePath, homeDir)
  }
}
