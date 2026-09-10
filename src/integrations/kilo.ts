import { renderKiloMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

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
