import { renderCursorMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

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
