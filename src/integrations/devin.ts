import { renderDevinMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Build the MCP payload Devin CLI reads, plus warnings for servers it cannot represent. */
export function buildDevinPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderDevinMcp(servers)
  return {
    payload: { mcpServers: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
