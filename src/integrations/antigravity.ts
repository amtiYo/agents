import { renderVscodeMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildAntigravityPayload(servers: ResolvedMcpServer[]): {
  payload: { servers: Record<string, unknown>; inputs: unknown[] }
  warnings: string[]
} {
  const rendered = renderVscodeMcp(servers)
  return {
    payload: {
      servers: rendered.servers,
      inputs: []
    },
    warnings: rendered.warnings
  }
}
