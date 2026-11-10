import { normalizeOpencodeConfig } from '../core/opencode.js'
import { renderOpencodeServers } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/**
 * Build the OpenCode preview. It always holds the V2 `mcp.servers` shape; sync picks
 * the shape actually written to `opencode.json` from what that file already uses.
 */
export function buildOpencodePayload(servers: ResolvedMcpServer[]): {
  payload: { $schema: string; mcp: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderOpencodeServers(servers)
  return {
    payload: normalizeOpencodeConfig({ mcp: { servers: rendered.servers } }),
    warnings: rendered.warnings
  }
}
