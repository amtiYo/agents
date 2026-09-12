import { loadAgentsConfig } from '../core/config.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { estimateTokens, probeServerTools, type ProbeResult } from '../core/mcpProbe.js'
import * as ui from '../core/ui.js'

export interface McpBudgetOptions {
  projectRoot: string
  profile?: string | null
  timeoutMs: number
  json: boolean
  /** Show every tool of every server instead of the per-server summary. */
  verbose: boolean
}

interface BudgetRow {
  server: string
  tools: number
  characters: number
  tokens: number
  status: 'ok' | 'error' | 'skipped'
  detail?: string
}

/** Fold a probe result into the one row per server the report prints. */
function toRow(result: ProbeResult): BudgetRow {
  if (result.skipped) {
    return { server: result.server, tools: 0, characters: 0, tokens: 0, status: 'skipped', detail: result.skipped }
  }
  if (!result.ok) {
    return { server: result.server, tools: 0, characters: 0, tokens: 0, status: 'error', detail: result.error }
  }
  return {
    server: result.server,
    tools: result.tools.length,
    characters: result.characters,
    tokens: estimateTokens(result.characters),
    status: 'ok'
  }
}

/**
 * Connect to every selected MCP server and report how much context its tool
 * definitions occupy, largest first.
 */
export async function runMcpBudget(options: McpBudgetOptions): Promise<void> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout value; expected a positive number of milliseconds.`)
  }

  const config = await loadAgentsConfig(options.projectRoot)
  const resolved = await loadResolvedRegistry(
    options.projectRoot,
    options.profile === undefined ? undefined : { profile: options.profile },
  )
  // Without --profile the active profile from the config applies, and the report has
  // to say which set was measured.
  const appliedProfile = options.profile === undefined ? config.activeProfile ?? null : options.profile

  // Servers can target different tools; measuring one entry per unique name is enough.
  const seen = new Map<string, (typeof resolved.serversByTarget)['codex'][number]>()
  for (const servers of Object.values(resolved.serversByTarget)) {
    for (const server of servers) {
      if (!seen.has(server.name)) seen.set(server.name, server)
    }
  }

  const servers = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (servers.length === 0) {
    if (options.json) {
      ui.json({
        profile: appliedProfile,
        totals: { tools: 0, estimatedTokens: 0 },
        servers: [],
        warnings: resolved.warnings,
        missingRequiredEnv: resolved.missingRequiredEnv
      })
      return
    }
    ui.info('No MCP servers selected.')
    for (const warning of resolved.warnings) ui.warning(warning)
    for (const entry of resolved.missingRequiredEnv) ui.warning(`Missing required env: ${entry}`)
    return
  }

  const spin = ui.spinner()
  if (!options.json) spin.start(`Measuring ${String(servers.length)} server(s)...`)

  const results = await Promise.all(
    servers.map((server) => probeServerTools(server, options.timeoutMs)),
  )

  if (!options.json) spin.stop('Measured')

  const rows = results.map(toRow).sort((a, b) => b.tokens - a.tokens || a.server.localeCompare(b.server))
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0)
  const totalTools = rows.reduce((sum, row) => sum + row.tools, 0)

  if (options.json) {
    ui.json({
      profile: appliedProfile,
      totals: { tools: totalTools, estimatedTokens: totalTokens },
      warnings: resolved.warnings,
      missingRequiredEnv: resolved.missingRequiredEnv,
      servers: rows,
      tools: options.verbose
        ? Object.fromEntries(
            results
              .filter((result) => result.ok)
              .map((result) => [
                result.server,
                result.tools.map((tool) => ({
                  name: tool.name,
                  estimatedTokens: estimateTokens(tool.characters)
                }))
              ]),
          )
        : undefined
    })
    return
  }

  ui.section('MCP context budget', () => {
    for (const row of rows) {
      if (row.status === 'ok') {
        ui.writeln(
          `  ${row.server.padEnd(22)} ${String(row.tools).padStart(3)} tools  ~${String(row.tokens).padStart(6)} tokens`,
        )
      } else {
        ui.writeln(`  ${row.server.padEnd(22)} ${row.status}: ${row.detail ?? ''}`)
      }
    }
  })

  if (options.verbose) {
    for (const result of results) {
      if (!result.ok || result.tools.length === 0) continue
      ui.blank()
      ui.writeln(`${result.server}:`)
      const sorted = [...result.tools].sort((a, b) => b.characters - a.characters)
      for (const tool of sorted) {
        ui.writeln(`  ${tool.name.padEnd(34)} ~${String(estimateTokens(tool.characters)).padStart(5)} tokens`)
      }
    }
  }

  ui.blank()
  ui.keyValue('Servers', String(rows.length))
  ui.keyValue('Tools', String(totalTools))
  ui.keyValue('Estimated', `~${String(totalTokens)} tokens of context`)
  ui.hint('Token counts are an estimate from the size of the tool definitions, not a model-side measurement.')

  for (const warning of resolved.warnings) ui.warning(warning)
  for (const entry of resolved.missingRequiredEnv) ui.warning(`Missing required env: ${entry}`)

  const failed = rows.filter((row) => row.status === 'error')
  if (failed.length > 0) {
    ui.blank()
    for (const row of failed) {
      ui.warning(`${row.server}: ${row.detail ?? 'failed to connect'}`)
    }
  }
}
