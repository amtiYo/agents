import { renderWindsurfMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildWindsurfPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderWindsurfMcp(servers)
  return {
    payload: { mcpServers: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
