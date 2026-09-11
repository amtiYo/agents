import { renderCursorMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Build the MCP payload Cursor reads, plus warnings for servers it cannot represent. */
export function buildCursorPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderCursorMcp(servers)
  return {
    payload: { mcpServers: rendered.servers },
    warnings: rendered.warnings
  }
}
