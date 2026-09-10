import { renderDevinMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

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
