import { renderOpencodeMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildOpencodePayload(servers: ResolvedMcpServer[]): {
  payload: { mcp: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderOpencodeMcp(servers)
  return {
    payload: { mcp: rendered.mcp },
    warnings: rendered.warnings
  }
}
