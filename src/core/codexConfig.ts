import TOML from '@iarna/toml'

export const CODEX_MANAGED_MCP_BEGIN = '# BEGIN agents-sync managed MCP'
export const CODEX_MANAGED_MCP_END = '# END agents-sync managed MCP'

/**
 * Merge generated MCP tables into a Codex project config without rewriting
 * project-owned settings. Agent Sync owns only the text between its markers.
 */
export function mergeCodexConfig(existingContent: string, generatedContent: string): string {
  validateToml(existingContent, 'existing Codex TOML')
  validateToml(generatedContent, 'generated Codex TOML')

  const beginIndex = existingContent.indexOf(CODEX_MANAGED_MCP_BEGIN)
  const endIndex = existingContent.indexOf(CODEX_MANAGED_MCP_END)
  const hasBegin = beginIndex >= 0
  const hasEnd = endIndex >= 0

  if (
    hasBegin !== hasEnd
    || (hasBegin && beginIndex !== existingContent.lastIndexOf(CODEX_MANAGED_MCP_BEGIN))
    || (hasEnd && endIndex !== existingContent.lastIndexOf(CODEX_MANAGED_MCP_END))
    || (hasBegin && endIndex < beginIndex)
  ) {
    throw new Error('Invalid existing Codex TOML: malformed agents-sync managed MCP block')
  }

  const managedBlock = [
    CODEX_MANAGED_MCP_BEGIN,
    generatedContent.trimEnd(),
    CODEX_MANAGED_MCP_END
  ].join('\n')

  let merged: string
  if (hasBegin && hasEnd) {
    merged = [
      existingContent.slice(0, beginIndex),
      managedBlock,
      existingContent.slice(endIndex + CODEX_MANAGED_MCP_END.length)
    ].join('')
  } else if (existingContent.length === 0) {
    merged = `${managedBlock}\n`
  } else {
    const separator = existingContent.endsWith('\n')
      ? (existingContent.endsWith('\n\n') ? '' : '\n')
      : '\n\n'
    merged = `${existingContent}${separator}${managedBlock}\n`
  }

  validateToml(merged, 'merged Codex TOML')
  return merged
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
