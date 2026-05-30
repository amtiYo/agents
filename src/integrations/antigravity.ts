import { renderAntigravityMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/**
 * Build the payload required by the Antigravity MCP integration from resolved server data.
 *
 * @param servers - Array of resolved MCP server configurations to be rendered for Antigravity
 * @returns An object containing:
 *   - `payload.mcpServers`: a record of rendered MCP server entries for Antigravity
 *   - `warnings`: an array of warning messages produced during rendering
 */
export function buildAntigravityPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderAntigravityMcp(servers)
  return {
    payload: {
      mcpServers: rendered.mcpServers
    },
    warnings: rendered.warnings
  }
}
