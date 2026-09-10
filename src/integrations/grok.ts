import { renderGrokToml } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

/** Grok Build shares Codex's `[mcp_servers.*]` TOML dialect, with headers in a plain `headers` table. */
export function buildGrokConfig(servers: ResolvedMcpServer[]): { content: string; warnings: string[] } {
  return renderGrokToml(servers)
}
