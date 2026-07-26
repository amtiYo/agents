import TOML from '@iarna/toml'

export const CODEX_MANAGED_MCP_BEGIN = '# BEGIN agents-sync managed MCP'
export const CODEX_MANAGED_MCP_END = '# END agents-sync managed MCP'

type TomlLexState = 'normal' | 'basic' | 'literal' | 'multilineBasic' | 'multilineLiteral'

interface StandaloneCommentLine {
  start: number
  contentEnd: number
}

/**
 * Merge generated MCP tables into a Codex project config without rewriting
 * project-owned settings. Agent Sync owns only the text between its markers.
 */
export function mergeCodexConfig(existingContent: string, generatedContent: string): string {
  validateToml(existingContent, 'existing Codex TOML')
  validateToml(generatedContent, 'generated Codex TOML')

  const beginLines = findStandaloneCommentLines(existingContent, CODEX_MANAGED_MCP_BEGIN)
  const endLines = findStandaloneCommentLines(existingContent, CODEX_MANAGED_MCP_END)
  const beginLine = beginLines[0]
  const endLine = endLines[0]
  const hasBegin = beginLine !== undefined
  const hasEnd = endLine !== undefined

  if (
    hasBegin !== hasEnd
    || beginLines.length > 1
    || endLines.length > 1
    || (beginLine !== undefined && endLine !== undefined && endLine.start < beginLine.start)
  ) {
    throw new Error('Invalid existing Codex TOML: malformed agents-sync managed MCP block')
  }

  const lineEnding = existingContent.includes('\r\n') ? '\r\n' : '\n'
  const normalizedGenerated = generatedContent
    .trimEnd()
    .replace(/\r\n|\n/g, lineEnding)
  const managedBlock = [
    CODEX_MANAGED_MCP_BEGIN,
    normalizedGenerated,
    CODEX_MANAGED_MCP_END
  ].join(lineEnding)

  let merged: string
  if (beginLine !== undefined && endLine !== undefined) {
    merged = [
      existingContent.slice(0, beginLine.start),
      managedBlock,
      existingContent.slice(endLine.contentEnd)
    ].join('')
  } else if (existingContent.length === 0) {
    merged = `${managedBlock}${lineEnding}`
  } else {
    const separator = existingContent.endsWith('\n') ? '' : lineEnding
    merged = `${existingContent}${separator}${managedBlock}${lineEnding}`
  }

  validateToml(merged, 'merged Codex TOML')
  return merged
}

function findStandaloneCommentLines(content: string, marker: string): StandaloneCommentLine[] {
  const matches: StandaloneCommentLine[] = []
  let state: TomlLexState = 'normal'
  let lineStart = 0

  while (lineStart <= content.length) {
    const newlineIndex = content.indexOf('\n', lineStart)
    const lineBreakStart = newlineIndex >= 0 ? newlineIndex : content.length
    const contentEnd = lineBreakStart > lineStart && content[lineBreakStart - 1] === '\r'
      ? lineBreakStart - 1
      : lineBreakStart

    if (state === 'normal' && content.slice(lineStart, contentEnd) === marker) {
      matches.push({ start: lineStart, contentEnd })
    }

    state = scanTomlLine(content, lineStart, contentEnd, state)
    if (newlineIndex < 0) break
    lineStart = newlineIndex + 1
  }

  return matches
}

function scanTomlLine(
  content: string,
  start: number,
  end: number,
  initialState: TomlLexState,
): TomlLexState {
  let state = initialState
  let index = start

  while (index < end) {
    if (state === 'normal') {
      if (content[index] === '#') break
      if (content.startsWith('"""', index)) {
        state = 'multilineBasic'
        index += 3
        continue
      }
      if (content.startsWith("'''", index)) {
        state = 'multilineLiteral'
        index += 3
        continue
      }
      if (content[index] === '"') {
        state = 'basic'
      } else if (content[index] === "'") {
        state = 'literal'
      }
      index += 1
      continue
    }

    if (state === 'basic') {
      if (content[index] === '\\') {
        index += 2
        continue
      }
      if (content[index] === '"') state = 'normal'
      index += 1
      continue
    }

    if (state === 'literal') {
      if (content[index] === "'") state = 'normal'
      index += 1
      continue
    }

    if (state === 'multilineBasic') {
      if (content[index] === '\\') {
        index += 2
        continue
      }
      if (content.startsWith('"""', index)) {
        index = consumeQuoteRun(content, index, end, '"')
        state = 'normal'
        continue
      }
      index += 1
      continue
    }

    if (content.startsWith("'''", index)) {
      index = consumeQuoteRun(content, index, end, "'")
      state = 'normal'
      continue
    }
    index += 1
  }

  return state
}

function consumeQuoteRun(content: string, start: number, end: number, quote: '"' | "'"): number {
  let index = start
  while (index < end && content[index] === quote) {
    index += 1
  }
  return index
}

function validateToml(content: string, label: string): void {
  if (content.trim().length === 0) return

  try {
    TOML.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid ${label}: ${message}`)
  }
}
