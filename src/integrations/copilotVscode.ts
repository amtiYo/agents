import { renderVscodeMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildVscodeMcpPayload(servers: ResolvedMcpServer[]): {
  payload: { servers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderVscodeMcp(servers)
  return {
    payload: { servers: rendered.servers },
    warnings: rendered.warnings
  }
}
