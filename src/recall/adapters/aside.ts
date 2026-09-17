import path from 'node:path'
import { asString, iterateJsonl, parseJsonObject } from '../jsonl.js'
import { asideHome, normalizeProjectPath } from '../paths.js'
import { extractSpeech, normalizeRole, parseTimestampMs } from '../speech.js'
import type { RecallAdapter, RecallParsedFile, RecallParsedTurn } from '../types.js'
import { walkFiles } from '../walk.js'

export const asideAdapter: RecallAdapter = {
  id: 'aside',

  async discover(homeDir, env) {
    const root = asideHome(homeDir, env)
    return walkFiles(root, (filePath, name) => name === 'messages.jsonl' && filePath.includes(`${path.sep}sessions${path.sep}`))
  },

  async parse(filePath) {
    const sessionId = path.basename(path.dirname(filePath))
    const turns: RecallParsedTurn[] = []

    for await (const line of iterateJsonl(filePath)) {
      if (line.oversized || !line.text.trim()) continue
      const record = parseJsonObject(line.text)
      if (!record) continue
      const role = normalizeRole(asString(record.role))
      if (!role) continue
      const text = (asString(record.content) ?? asString(record.text) ?? extractSpeech(record.content) ?? extractSpeech(record.message)).trim()
      if (!text) continue
      turns.push({
        sessionId,
        role,
        timestampMs: parseTimestampMs(record.timestamp),
        project: normalizeProjectPath(asString(record.cwd) ?? asString(record.project)),
        text,
        tools: [],
        paths: [],
        sourceKind: 'jsonl',
        sourceLine: line.lineNo,
        sourceKey: asString(record.responseId) ?? asString(record.id)
      })
    }

    return {
      provider: 'aside',
      path: filePath,
      skipped: turns.length === 0 ? 'empty' : null,
      turns
    }
  }
}
