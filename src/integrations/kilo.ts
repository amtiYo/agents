import { renderKiloMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Build the MCP payload Kilo reads, plus warnings for servers it cannot represent. */
export function buildKiloPayload(servers: ResolvedMcpServer[]): {
  payload: { mcp: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderKiloMcp(servers)
  return {
    payload: { mcp: rendered.mcp },
    warnings: rendered.warnings
  }
}
