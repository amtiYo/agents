import { renderDroidMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

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
