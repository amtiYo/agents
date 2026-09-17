import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { asRecord, asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import { grokHome, normalizeProjectPath } from '../paths.js'
import { extractSpeech, normalizeRole, parseTimestampMs } from '../speech.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn, RecallRole } from '../types.js'
import { walkFiles } from '../walk.js'

async function readSummary(sessionDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(sessionDir, 'summary.json'), 'utf8')
    return parseJsonObject(raw)
  } catch {
    return null
  }
}

function grokCwdFromPath(filePath: string): string | null {
  const group = path.dirname(path.dirname(filePath))
  try {
    return decodeURIComponent(path.basename(group))
  } catch {
    return path.basename(group)
  }
}

function isSubagentKind(kind: string | null): boolean {
  if (!kind) return false
  const lower = kind.toLowerCase()
  return lower === 'subagent' || (lower.startsWith('subagent_') && lower !== 'subagent_resume')
}

function contentText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const record = asRecord(raw)
  if (record) {
    if (typeof record.text === 'string' && (asString(record.type) === 'text' || !record.type)) {
      return record.text
    }
  }
  return extractSpeech(raw)
}

async function parseUpdates(filePath: string, sessionId: string, project: string | null): Promise<RecallParsedTurn[]> {
  const turns: RecallParsedTurn[] = []
  let lastKey = ''
  for await (const line of iterateJsonl(filePath)) {
    if (line.oversized || !line.text.trim()) continue
    const prefix = line.text.slice(0, 400)
    if (!prefix.includes('user_message_chunk') && !prefix.includes('agent_message_chunk')) continue
    const record = parseJsonObject(line.text)
    if (!record) continue
    const params = asRecord(record.params)
    const update = asRecord(params?.update)
    const kind = asString(update?.sessionUpdate)
    const role: RecallRole | null = kind === 'user_message_chunk' ? 'user' : kind === 'agent_message_chunk' ? 'assistant' : null
    if (!role) continue
    const text = contentText(update?.content)
    if (!text) continue
    const meta = asRecord(params?._meta)
    const updateMeta = asRecord(update?._meta)
    const key =
      role === 'assistant'
        ? `assistant:${asString(meta?.promptId) ?? ''}`
        : `user:${asString(asRecord(updateMeta)?.promptIndex) ?? asString(updateMeta?.promptIndex) ?? ''}`
    if (key && key === lastKey && turns.length > 0) {
      turns[turns.length - 1].text += text
      turns[turns.length - 1].sourceLine = line.lineNo
      continue
    }
    lastKey = key
    if (!text.trim()) continue
    turns.push({
      sessionId,
      role,
      timestampMs: parseTimestampMs(record.timestamp) ?? parseTimestampMs(meta?.agentTimestampMs),
      project,
      text,
      tools: [],
      paths: [],
      sourceKind: 'jsonl',
      sourceLine: line.lineNo,
      sourceKey: key || null
    })
  }
  return turns
}

async function parseChatHistory(filePath: string, sessionId: string, project: string | null): Promise<RecallParsedTurn[]> {
  const turns: RecallParsedTurn[] = []
  for await (const line of iterateJsonl(filePath)) {
    if (line.oversized || !line.text.trim()) continue
    const record = parseJsonObject(line.text)
    if (!record) continue
    if (asString(record.synthetic_reason)) continue
    const role = normalizeRole(asString(record.type) ?? asString(record.role))
    if (!role) continue
    const text = (asString(record.content) ?? extractSpeech(record.content) ?? extractSpeech(record)).trim()
    if (!text) continue
    turns.push({
      sessionId,
      role,
      timestampMs: parseTimestampMs(record.timestamp),
      project,
      text,
      tools: [],
      paths: [],
      sourceKind: 'jsonl',
      sourceLine: line.lineNo,
      sourceKey: asString(record.id)
    })
  }
  return turns
}

export const grokAdapter: RecallAdapter = {
  id: 'grok',

  async discover(homeDir, env) {
    const root = path.join(grokHome(homeDir, env), 'sessions')
    const updates = await walkFiles(root, (_filePath, name) => name === 'updates.jsonl')
    const histories = await walkFiles(root, (_filePath, name) => name === 'chat_history.jsonl')
    const covered = new Set(updates.map((file) => path.dirname(file)))
    const extra = histories.filter((file) => !covered.has(path.dirname(file)))
    return [...updates, ...extra].sort()
  },

  async parse(filePath) {
    const sessionDir = path.dirname(filePath)
    const summary = await readSummary(sessionDir)
    const info = asRecord(summary?.info)
    const sessionId = asString(info?.id) ?? path.basename(sessionDir)
    const kind = asString(summary?.session_kind)
    if (isSubagentKind(kind)) {
      return { provider: 'grok', path: filePath, skipped: 'subagent', turns: [] }
    }
    const project =
      normalizeProjectPath(asString(info?.cwd)) ?? normalizeProjectPath(grokCwdFromPath(filePath))

    const turns =
      path.basename(filePath) === 'updates.jsonl'
        ? await parseUpdates(filePath, sessionId, project)
        : await parseChatHistory(filePath, sessionId, project)

    return {
      provider: 'grok',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  }
}
