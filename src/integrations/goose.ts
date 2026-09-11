import { renderGooseExtensions } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Build the MCP payload Goose reads, plus warnings for servers it cannot represent. */
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
