import { createReadStream } from 'node:fs'
import readline from 'node:readline'
import { isObject } from '../core/objectUtils.js'

/** Skip JSONL lines larger than this — they are almost always tool dumps. */
export const MAX_JSONL_LINE_BYTES = 512 * 1024

export interface JsonlLine {
  lineNo: number
  offset: number
  text: string
  oversized: boolean
}

/**
 * Stream a JSONL file line by line without loading it into memory.
 *
 * Oversized lines are yielded with empty text so callers can skip tool dumps
 * without buffering tens of megabytes.
 */
export async function* iterateJsonl(
  filePath: string,
  maxLineBytes = MAX_JSONL_LINE_BYTES
): AsyncGenerator<JsonlLine> {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let lineNo = 0
  let offset = 0
  try {
    for await (const line of rl) {
      lineNo += 1
      const byteLength = Buffer.byteLength(line, 'utf8')
      if (byteLength > maxLineBytes) {
        yield { lineNo, offset, text: '', oversized: true }
      } else {
        yield { lineNo, offset, text: line, oversized: false }
      }
      offset += byteLength + 1
    }
  } finally {
    rl.close()
    stream.destroy()
  }
}

/** Read a single 1-based JSONL line. Returns null when the line is missing or oversized. */
export async function readJsonlLine(
  filePath: string,
  lineNo: number,
  maxLineBytes = MAX_JSONL_LINE_BYTES
): Promise<string | null> {
  for await (const line of iterateJsonl(filePath, maxLineBytes)) {
    if (line.lineNo === lineNo) {
      return line.oversized ? null : line.text
    }
    if (line.lineNo > lineNo) return null
  }
  return null
}

export function parseJsonValue(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const value = parseJsonValue(text)
  return isObject(value) ? value : null
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

export function asBoolean(value: unknown): boolean {
  return value === true
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
