import { renderCodexToml } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildCodexConfig(servers: ResolvedMcpServer[]): { content: string; warnings: string[] } {
  return renderCodexToml(servers)
}
