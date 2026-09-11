import { renderDroidMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Build the MCP payload Factory Droid reads, plus warnings for servers it cannot represent. */
export function buildDroidPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderDroidMcp(servers)
  return {
    payload: { mcpServers: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
