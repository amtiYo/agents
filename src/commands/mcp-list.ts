import path from 'node:path'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import * as ui from '../core/ui.js'

export interface McpListOptions {
  projectRoot: string
  json: boolean
}

export async function runMcpList(options: McpListOptions): Promise<void> {
  ui.setContext({ json: options.json })

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
    ui.json(payload)
    return
  }

  ui.keyValue('Project', payload.projectRoot)
  ui.keyValue('MCP servers', String(payload.count))

  if (payload.count === 0) {
    ui.blank()
    ui.dim('No MCP servers configured.')
    return
  }

  ui.blank()
  for (const server of payload.servers) {
    const targets = server.targets.length > 0 ? server.targets.join(', ') : 'all'
    const parts: string[] = []

    // Transport type
    parts.push(server.transport)

    // Targets
    parts.push(`targets: ${targets}`)

    // Status indicators
    if (!server.enabled) {
      parts.push('disabled')
    }
    if (server.hasLocalOverride) {
      parts.push('local override')
    }

    const statusSymbol = server.enabled ? ui.symbols.success : ui.symbols.info
    const statusColor = server.enabled
      ? ui.color.green(statusSymbol)
      : ui.color.dim(statusSymbol)

    ui.writeln(`  ${statusColor} ${server.name}  ${ui.color.dim(parts.join(' | '))}`)
  }
}
