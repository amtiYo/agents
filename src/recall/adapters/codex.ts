import path from 'node:path'
import { asRecord, asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import { codexHome, normalizeProjectPath } from '../paths.js'
import { extractSpeech, extractToolNames, extractToolPaths, normalizeRole, parseTimestampMs } from '../speech.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn, RecallRole } from '../types.js'
import { walkFiles } from '../walk.js'

function isCodexRollout(name: string): boolean {
  return name.includes('rollout-') && name.endsWith('.jsonl') && !name.endsWith('.jsonl.zst')
}

function filenameSessionId(filePath: string): string {
  return path.basename(filePath).replace(/^rollout-/, '').replace(/\.jsonl$/, '')
}

function isSubagentMeta(payload: Record<string, unknown>): boolean {
  const threadSource = asString(payload.thread_source)?.toLowerCase()
  if (threadSource === 'subagent') return true
  const source = asRecord(payload.source)
  if (source && asRecord(source.subagent)) return true
  return false
}

function payloadRole(payload: Record<string, unknown>, payloadType: string | null): RecallRole | null {
  const fromField = normalizeRole(asString(payload.role))
  if (fromField) return fromField
  if (payloadType === 'agent_message') return 'assistant'
  if (payloadType === 'user_message') return 'user'
  return null
}

export const codexAdapter: RecallAdapter = {
  id: 'codex',

  async discover(homeDir, env) {
    const root = codexHome(homeDir, env)
    const dirs = [path.join(root, 'sessions'), path.join(root, 'archived_sessions')]
    const files: string[] = []
    for (const dir of dirs) {
      files.push(...(await walkFiles(dir, (_filePath, name) => isCodexRollout(name))))
    }
    return files.sort()
  },

  async parse(filePath) {
    const fallbackId = filenameSessionId(filePath)
    let sessionId = fallbackId
    let project: string | null = null
    let subagent = false
    const speechTurns: RecallParsedTurn[] = []
    const eventTurns: RecallParsedTurn[] = []
    const pendingTools: string[] = []
    const pendingPaths: string[] = []

    const attachTools = (turn: RecallParsedTurn): void => {
      if (pendingTools.length > 0) {
        turn.tools = [...new Set([...turn.tools, ...pendingTools])]
        pendingTools.length = 0
      }
      if (pendingPaths.length > 0) {
        turn.paths = [...new Set([...turn.paths, ...pendingPaths])]
        pendingPaths.length = 0
      }
    }

    for await (const line of iterateJsonl(filePath)) {
      if (line.oversized || !line.text.trim()) continue
      const prefix = line.text.slice(0, 800)
      if (
        prefix.includes('"function_call_output"') ||
        prefix.includes('"custom_tool_call_output"') ||
        prefix.includes('"token_count"')
      ) {
        continue
      }

      const record = parseJsonObject(line.text)
      if (!record) continue
      const type = asString(record.type)
      const payload = asRecord(record.payload) ?? {}
      const timestampMs = parseTimestampMs(record.timestamp) ?? parseTimestampMs(payload.timestamp)

      if (type === 'session_meta') {
        const id = asString(payload.id)
        const sid = asString(payload.session_id) ?? asString(payload.sessionId)
        if (id) sessionId = id
        else if (sid) sessionId = sid
        project = normalizeProjectPath(asString(payload.cwd)) ?? project
        if (isSubagentMeta(payload)) subagent = true
        continue
      }

      const payloadType = asString(payload.type)

      if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        const name = asString(payload.name)
        if (name) pendingTools.push(name)
        pendingPaths.push(...extractToolPaths(payload.arguments ?? payload.input ?? payload))
        continue
      }

      const role = payloadRole(payload, payloadType)
      if (!role) continue
      const text = (extractSpeech(payload.content) || asString(payload.message) || '').trim()
      if (!text) continue

      const turn: RecallParsedTurn = {
        sessionId,
        role,
        timestampMs,
        project,
        text,
        tools: extractToolNames(payload.content),
        paths: extractToolPaths(payload.content),
        sourceKind: 'jsonl',
        sourceLine: line.lineNo,
        sourceKey: asString(payload.id)
      }
      attachTools(turn)

      if (type === 'event_msg') {
        eventTurns.push(turn)
      } else {
        speechTurns.push(turn)
      }
    }

    if (subagent) {
      return { provider: 'codex', path: filePath, skipped: 'subagent', turns: [] }
    }

    const turns = speechTurns.length > 0 ? speechTurns : eventTurns
    for (const turn of turns) {
      turn.sessionId = sessionId
      turn.project = turn.project ?? project
    }

    return {
      provider: 'codex',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  }
}
