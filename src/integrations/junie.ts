import { renderJunieMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildJuniePayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderJunieMcp(servers)
  return {
    payload: { mcpServers: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
