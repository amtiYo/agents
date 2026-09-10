import { renderGooseExtensions } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildGoosePayload(servers: ResolvedMcpServer[]): {
  payload: { extensions: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderGooseExtensions(servers)
  return {
    payload: { extensions: rendered.extensions },
    warnings: rendered.warnings
  }
}
