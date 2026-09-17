import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathExists } from '../../core/fs.js'
import { asArray, asRecord, asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import { geminiHome, normalizeProjectPath, pathHasDirNamed } from '../paths.js'
import { extractSpeech, extractToolNames, extractToolPaths, isToolResultContent, parseTimestampMs } from '../speech.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn, RecallRole } from '../types.js'
import { walkFiles } from '../walk.js'

const MAX_JSON_BYTES = 20 * 1024 * 1024

async function geminiProjectName(filePath: string, homeDir: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  let idDir = path.dirname(path.dirname(filePath))
  if (path.basename(path.dirname(filePath)) !== 'chats' && path.basename(idDir) === 'chats') {
    idDir = path.dirname(idDir)
  }
  const id = path.basename(idDir)
  const mapped = await projectFromRegistry(id, homeDir, env)
  if (mapped) return mapped
  try {
    const marker = await readFile(path.join(idDir, '.project_root'), 'utf8')
    return normalizeProjectPath(marker.trim())
  } catch {
    return id || null
  }
}

async function projectFromRegistry(id: string, homeDir: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const registry = path.join(geminiHome(homeDir, env), 'projects.json')
  if (!(await pathExists(registry))) return null
  try {
    const raw = await readFile(registry, 'utf8')
    const doc = parseJsonObject(raw)
    const projects = asRecord(doc?.projects)
    if (!projects) return null
    for (const [projectPath, projectId] of Object.entries(projects)) {
      if (projectId === id) return normalizeProjectPath(projectPath)
    }
  } catch {
    return null
  }
  return null
}

function messageRole(type: string | null): RecallRole | null {
  if (type === 'user') return 'user'
  if (type === 'gemini' || type === 'model' || type === 'assistant') return 'assistant'
  return null
}

function turnsFromMessages(
  messages: unknown[],
  sessionId: string,
  project: string | null,
  sourceKind: 'json' | 'jsonl',
  sourceLine: number | null
): RecallParsedTurn[] {
  const turns: RecallParsedTurn[] = []
  for (const [index, item] of messages.entries()) {
    const message = asRecord(item)
    if (!message) continue
    const role = messageRole(asString(message.type))
    if (!role) continue
    const content = message.content
    if (role === 'user' && isToolResultContent(content)) continue
    const text = extractSpeech(content).trim()
    const tools = extractToolNames(message.toolCalls ?? content)
    const paths = extractToolPaths(message.toolCalls ?? content)
    if (!text && tools.length === 0) continue
    if (!text) continue
    turns.push({
      sessionId,
      role,
      timestampMs: parseTimestampMs(message.timestamp),
      project,
      text,
      tools,
      paths,
      sourceKind,
      sourceLine: sourceKind === 'jsonl' ? sourceLine : index,
      sourceKey: asString(message.id)
    })
  }
  return turns
}

async function parseGeminiJson(filePath: string, project: string | null): Promise<RecallParsedFile> {
  const raw = await readFile(filePath, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_JSON_BYTES) {
    return { provider: 'gemini', path: filePath, skipped: 'empty', turns: [] }
  }
  const doc = parseJsonObject(raw)
  if (!doc) return { provider: 'gemini', path: filePath, skipped: 'empty', turns: [] }
  const sessionId = asString(doc.sessionId)
  if (!sessionId) return { provider: 'gemini', path: filePath, skipped: 'empty', turns: [] }
  const turns = turnsFromMessages(asArray(doc.messages), sessionId, project, 'json', null)
  return { provider: 'gemini', path: filePath, skipped: turns.length === 0 ? 'empty' : null, turns }
}

async function parseGeminiJsonl(filePath: string, project: string | null): Promise<RecallParsedFile> {
  let sessionId = ''
  let messages: unknown[] = []
  let lineNo = 0
  let started = false

  for await (const line of iterateJsonl(filePath)) {
    lineNo = line.lineNo
    if (line.oversized || !line.text.trim()) continue
    const record = parseJsonObject(line.text)
    if (!record) continue
    if (!started) {
      const id = asString(record.sessionId)
      if (!id) continue
      sessionId = id
      started = true
      continue
    }
    const patch = asRecord(record.$set)
    if (patch) {
      if (Array.isArray(patch.messages)) messages = patch.messages
      continue
    }
    if (typeof record.$rewindTo === 'string') {
      const rid = record.$rewindTo
      const index = messages.findIndex((item) => asString(asRecord(item)?.id) === rid)
      if (index >= 0) messages = messages.slice(0, index)
      continue
    }
    if (asString(record.type)) messages.push(record)
  }

  const turns = turnsFromMessages(messages, sessionId, project, 'jsonl', lineNo)
  return { provider: 'gemini', path: filePath, skipped: turns.length === 0 ? 'empty' : null, turns }
}

export const geminiAdapter: RecallAdapter = {
  id: 'gemini',

  async discover(homeDir, env) {
    const tmp = path.join(geminiHome(homeDir, env), 'tmp')
    return walkFiles(tmp, (filePath, name) => {
      if (pathHasDirNamed(filePath, 'subagents')) return false
      const inChats = pathHasDirNamed(filePath, 'chats')
      if (!inChats) return false
      return (name.startsWith('session-') && name.endsWith('.json')) || name.endsWith('.jsonl')
    })
  },

  async parse(filePath, homeDir, env) {
    const project = await geminiProjectName(filePath, homeDir, env)
    if (filePath.endsWith('.jsonl')) return parseGeminiJsonl(filePath, project)
    return parseGeminiJson(filePath, project)
  }
}
