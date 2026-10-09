import { normalizeOpencodeConfig } from '../core/opencode.js'
import { renderOpencodeMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildOpencodePayload(servers: ResolvedMcpServer[]): {
  payload: { $schema: string; mcp: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderOpencodeMcp(servers)
  return {
    payload: normalizeOpencodeConfig({ mcp: rendered.mcp }),
    warnings: rendered.warnings
  }
}
