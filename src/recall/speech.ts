import { asArray, asRecord, asString } from './jsonl.js'
import type { RecallRole } from './types.js'

const SKIP_BLOCK_TYPES = new Set([
  'tool_use',
  'tool_result',
  'tool_use_id',
  'function_call',
  'function_call_output',
  'functionCall',
  'functionResponse',
  'image',
  'image_url',
  'thinking',
  'redacted_thinking',
  'server_tool_use',
  'web_search_tool_result'
])

const PATH_KEYS = ['file_path', 'target_file', 'filePath', 'path', 'file', 'uri', 'targetFile']

export const MAX_SPEECH_CHARS = 100_000
export const INDEX_QUOTE_CHARS = 500

const SKIP_ROLES = new Set(['system', 'tool', 'function', 'developer'])

export function isSpeechRole(role: string | null): role is RecallRole {
  return role === 'user' || role === 'assistant'
}

export function normalizeRole(value: string | null): RecallRole | null {
  if (!value) return null
  const lower = value.toLowerCase()
  if (lower === 'user' || lower === 'human') return 'user'
  if (lower === 'assistant' || lower === 'model' || lower === 'ai' || lower === 'gemini' || lower === 'bot') {
    return 'assistant'
  }
  if (SKIP_ROLES.has(lower)) return null
  return null
}

function blockType(block: Record<string, unknown>): string {
  return (asString(block.type) ?? '').toLowerCase()
}

function textFromBlock(block: unknown): string {
  if (typeof block === 'string') return block
  const record = asRecord(block)
  if (!record) return ''
  const type = blockType(record)
  if (SKIP_BLOCK_TYPES.has(type) || SKIP_BLOCK_TYPES.has(asString(record.type) ?? '')) return ''
  if (type === 'input_text' || type === 'output_text' || type === 'text' || type === '') {
    const text = asString(record.text) ?? asString(record.input_text) ?? asString(record.output_text)
    if (text) return text
  }
  if (typeof record.text === 'string') return record.text
  if (record.content !== undefined) return extractSpeech(record.content)
  return ''
}

/**
 * Pull spoken text out of Anthropic/OpenAI/Gemini content shapes.
 *
 * Tool payloads, images and thinking blocks are dropped.
 */
export function extractSpeech(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)
  if (Array.isArray(content)) {
    return content.map((block) => textFromBlock(block)).filter((part) => part.length > 0).join('\n')
  }
  const record = asRecord(content)
  if (!record) return ''
  if (typeof record.text === 'string' && !SKIP_BLOCK_TYPES.has(blockType(record))) {
    return record.text
  }
  if (record.content !== undefined && record.content !== content) {
    return extractSpeech(record.content)
  }
  return ''
}

function collectToolName(block: Record<string, unknown>, into: Set<string>): void {
  const type = asString(block.type)
  if (type === 'tool_use' || type === 'tool_call' || type === 'function_call' || type === 'server_tool_use') {
    const name = asString(block.name) ?? asString(asRecord(block.function)?.name)
    if (name) into.add(name)
  }
  const functionCall = asRecord(block.functionCall) ?? asRecord(block.function_call)
  if (functionCall) {
    const name = asString(functionCall.name)
    if (name) into.add(name)
  }
  if (asString(block.tool)) into.add(asString(block.tool) as string)
}

function collectPathsFromUnknown(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 4 || value == null) return
  if (typeof value === 'string') {
    if (looksLikePath(value)) into.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathsFromUnknown(item, into, depth + 1)
    return
  }
  const record = asRecord(value)
  if (!record) return
  for (const key of PATH_KEYS) {
    const pathValue = asString(record[key])
    if (pathValue) into.add(pathValue)
  }
  const input = record.input ?? record.arguments ?? record.args
  if (typeof input === 'string') {
    const parsed = tryParseJson(input)
    collectPathsFromUnknown(parsed ?? input, into, depth + 1)
  } else {
    collectPathsFromUnknown(input, into, depth + 1)
  }
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function looksLikePath(value: string): boolean {
  if (value.length < 2 || value.length > 512) return false
  if (value.includes('://') && !value.startsWith('file:')) return false
  return value.includes('/') || value.includes('\\') || /\.[A-Za-z0-9]{1,8}$/.test(value)
}

/** Tool names mentioned in a content payload (metadata only). */
export function extractToolNames(content: unknown): string[] {
  const names = new Set<string>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 5 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const record = asRecord(value)
    if (!record) return
    collectToolName(record, names)
    walk(record.content, depth + 1)
    walk(record.toolCalls, depth + 1)
    walk(record.tool_calls, depth + 1)
  }
  walk(content, 0)
  return [...names]
}

/** File paths a tool named, never the file body. */
export function extractToolPaths(content: unknown): string[] {
  const paths = new Set<string>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 5 || value == null) return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    const record = asRecord(value)
    if (!record) return
    const type = asString(record.type)
    if (type === 'tool_use' || type === 'function_call' || type === 'tool_call' || record.functionCall || record.input) {
      collectPathsFromUnknown(record, paths)
    }
    walk(record.content, depth + 1)
    walk(record.toolCalls, depth + 1)
  }
  walk(content, 0)
  return [...paths]
}

export function isToolResultContent(content: unknown): boolean {
  if (typeof content === 'string') return false
  const blocks = asArray(content)
  if (blocks.length === 0) {
    const record = asRecord(content)
    if (!record) return false
    const type = asString(record.type)
    return type === 'tool_result' || type === 'functionResponse' || Boolean(record.tool_use_id)
  }
  return blocks.every((block) => {
    const record = asRecord(block)
    if (!record) return false
    const type = asString(record.type)
    return type === 'tool_result' || type === 'tool_use' || type === 'functionResponse' || type === 'functionCall'
  })
}

export function clipSpeech(text: string, max = MAX_SPEECH_CHARS): string {
  if (text.length <= max) return text
  return text.slice(0, max)
}

export function clipQuote(text: string, max = INDEX_QUOTE_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1)}…`
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

export function parseTimestampMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000)
  }
  if (typeof value === 'bigint') return parseTimestampMs(Number(value))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (/^\d+(\.\d+)?$/.test(trimmed)) return parseTimestampMs(Number(trimmed))
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function isoFromMs(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}
