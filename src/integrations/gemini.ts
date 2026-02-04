import { renderGeminiServers } from '../core/renderers.js'
import type { ResolvedMcpServer } from '../types.js'

export interface GeminiPayload {
  context: {
    fileName: string
  }
  contextFileName: string
  mcpServers: Record<string, unknown>
}

export function buildGeminiPayload(servers: ResolvedMcpServer[]): {
  payload: GeminiPayload
  warnings: string[]
} {
  const rendered = renderGeminiServers(servers)
  return {
    payload: {
      context: {
        fileName: 'AGENTS.md'
      },
      contextFileName: 'AGENTS.md',
      mcpServers: rendered.mcpServers
    },
    warnings: rendered.warnings
  }
}
