import path from 'node:path'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'

export interface McpListOptions {
  projectRoot: string
  json: boolean
}

export async function runMcpList(options: McpListOptions): Promise<void> {
  const state = await loadMcpState(options.projectRoot)
  const entries = listMcpEntries(state)

  const payload = {
    projectRoot: path.resolve(options.projectRoot),
    count: entries.length,
    servers: entries.map((entry) => ({
      name: entry.name,
      transport: entry.server.transport,
      enabled: entry.server.enabled !== false,
      targets: entry.server.targets ?? [],
      hasLocalOverride: entry.hasLocalOverride,
      description: entry.server.description ?? null
    }))
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  process.stdout.write(`Project: ${payload.projectRoot}\n`)
  process.stdout.write(`MCP servers: ${String(payload.count)}\n`)
  if (payload.count === 0) {
    process.stdout.write('No MCP servers configured.\n')
    return
  }
  for (const server of payload.servers) {
    const status = server.enabled ? 'enabled' : 'disabled'
    const targets = server.targets.length > 0 ? server.targets.join(', ') : 'all'
    process.stdout.write(
      `- ${server.name}: ${server.transport} (${status}), targets: ${targets}${server.hasLocalOverride ? ', local override' : ''}\n`,
    )
  }
}
