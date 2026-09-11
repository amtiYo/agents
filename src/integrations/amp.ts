import { renderAmpMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Key Amp reads inside its settings file. */
export const AMP_MCP_KEY = 'amp.mcpServers'

/** Build the MCP payload Amp reads, plus warnings for servers it cannot represent. */
export function buildAmpPayload(servers: ResolvedMcpServer[]): {
  payload: Record<string, unknown>
  warnings: string[]
} {
  const rendered = renderAmpMcp(servers)
  return {
    payload: { [AMP_MCP_KEY]: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
