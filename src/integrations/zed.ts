import { renderZedContextServers } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Key Zed reads inside its settings file. */
export const ZED_CONTEXT_SERVERS_KEY = 'context_servers'

/** Build the MCP payload Zed reads, plus warnings for servers it cannot represent. */
export function buildZedPayload(servers: ResolvedMcpServer[]): {
  payload: Record<string, unknown>
  warnings: string[]
} {
  const rendered = renderZedContextServers(servers)
  return {
    payload: { [ZED_CONTEXT_SERVERS_KEY]: rendered.contextServers },
    warnings: rendered.warnings
  }
}
