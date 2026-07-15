import type { ResolvedMcpServer } from '../types.js'

export interface HermesPayload {
  mcpServers: Record<string, Record<string, unknown>>
  warnings: string[]
}

/**
 * Convert resolved Agent Sync MCP definitions to Hermes Agent's native
 * `mcp_servers` mapping.
 */
export function buildHermesPayload(servers: ResolvedMcpServer[]): HermesPayload {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  const warnings: string[] = []

  for (const server of servers) {
    const rendered: Record<string, unknown> = { enabled: true }

    if (server.transport === 'stdio') {
      rendered.command = server.command
      rendered.args = server.args ?? []
      if (server.env && Object.keys(server.env).length > 0) {
        rendered.env = server.env
      }
      if (server.cwd) {
        warnings.push(`Hermes MCP server "${server.name}" does not support cwd; omitted ${server.cwd}.`)
      }
    } else {
      rendered.url = server.url
      if (server.transport === 'sse') {
        rendered.transport = 'sse'
      }
      if (server.headers && Object.keys(server.headers).length > 0) {
        rendered.headers = server.headers
      }
    }

    mcpServers[server.name] = rendered
  }

  return { mcpServers, warnings }
}
