import path from 'node:path'
import { asBoolean, asRecord, asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import { claudeProjectDirs, normalizeProjectPath, pathHasDirNamed, resolveEncodedPath } from '../paths.js'
import { extractSpeech, extractToolNames, extractToolPaths, isToolResultContent, parseTimestampMs } from '../speech.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn, RecallRole } from '../types.js'
import { walkFiles } from '../walk.js'

function sessionIdFromFile(filePath: string): string {
  return path.basename(filePath, path.extname(filePath))
}

async function projectFromClaudePath(filePath: string, homeDir: string): Promise<string | null> {
  let dir = path.dirname(filePath)
  if (path.basename(dir) === 'subagents') {
    dir = path.dirname(path.dirname(dir))
  }
  const encoded = path.basename(dir)
  if (!encoded || encoded === 'projects') return null
  const resolved = await resolveEncodedPath(encoded.startsWith('-') ? encoded : `-${encoded}`, homeDir)
  return normalizeProjectPath(resolved)
}

function parseClaudeRole(record: Record<string, unknown>): RecallRole | null {
  const type = asString(record.type)
  if (type === 'user' || type === 'assistant') return type
  return null
}

export const claudeAdapter: RecallAdapter = {
  id: 'claude',

  async discover(homeDir, env) {
    const roots = await claudeProjectDirs(homeDir, env)
    const files: string[] = []
    for (const root of roots) {
      const found = await walkFiles(root, (filePath, name) => name.endsWith('.jsonl'))
      files.push(...found)
    }
    return [...new Set(files)].sort()
  },

  async parse(filePath, homeDir) {
    const skippedSubagent = pathHasDirNamed(filePath, 'subagents')
    if (skippedSubagent) {
      return { provider: 'claude', path: filePath, skipped: 'subagent', turns: [] }
    }

    const fallbackProject = await projectFromClaudePath(filePath, homeDir)
    const fallbackSession = sessionIdFromFile(filePath)
    const turns: RecallParsedTurn[] = []

    for await (const line of iterateJsonl(filePath)) {
      if (line.oversized || !line.text.trim()) continue
      const record = parseJsonObject(line.text)
      if (!record) continue
      const role = parseClaudeRole(record)
      if (!role) continue
      if (asBoolean(record.isSidechain)) continue
      if (asBoolean(record.isMeta)) continue

      const message = asRecord(record.message) ?? record
      const content = message.content ?? record.content
      if (role === 'user' && isToolResultContent(content)) continue

      const text = extractSpeech(content).trim()
      if (!text) continue

      const sessionId = asString(record.sessionId) ?? asString(record.session_id) ?? fallbackSession
      const project = normalizeProjectPath(asString(record.cwd)) ?? fallbackProject

      turns.push({
        sessionId,
        role,
        timestampMs: parseTimestampMs(record.timestamp),
        project,
        text,
        tools: extractToolNames(content),
        paths: extractToolPaths(content),
        sourceKind: 'jsonl',
        sourceLine: line.lineNo,
        sourceKey: asString(message.id) ?? asString(record.uuid)
      })
    }

    return {
      provider: 'claude',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  }
}
