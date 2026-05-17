import { renderCopilotCliMcp } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export function buildCopilotCliPayload(servers: ResolvedMcpServer[]): {
  payload: { mcpServers: Record<string, unknown> }
  warnings: string[]
} {
  const rendered = renderCopilotCliMcp(servers)
  return {
    payload: { mcpServers: rendered.mcpServers },
    warnings: rendered.warnings
  }
}
