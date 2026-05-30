import { renderAntigravityMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

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
