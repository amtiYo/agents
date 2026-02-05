import { validateServerName } from '../core/mcpValidation.js'
import { removeMcpServer } from '../core/mcpCrud.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'

export interface McpRemoveOptions {
  projectRoot: string
  name: string
  ignoreMissing: boolean
  noSync: boolean
}

export async function runMcpRemove(options: McpRemoveOptions): Promise<void> {
  validateServerName(options.name)
  const removed = await removeMcpServer({
    projectRoot: options.projectRoot,
    name: options.name,
    ignoreMissing: options.ignoreMissing
  })

  if (!removed) {
    process.stdout.write(`MCP server "${options.name}" not found (ignored).\n`)
    return
  }

  const warnings: string[] = []
  if (!options.noSync) {
    const sync = await performSync({
      projectRoot: options.projectRoot,
      check: false,
      verbose: false
    })
    warnings.push(...sync.warnings)
  }

  process.stdout.write(`Removed MCP server: ${options.name}\n`)
  if (options.noSync) {
    process.stdout.write('Skipped sync (--no-sync).\n')
  }
  const warningBlock = formatWarnings(warnings, 4)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
}
