import { ingest, reindex } from '../recall/ingest.js'
import { installRecall, type RecallInstallResult } from '../recall/install.js'
import { runRecallMcpServer } from '../recall/mcp.js'
import {
  recallAbout,
  recallDoctor,
  recallGet,
  recallProject,
  recallSearch,
  type RecallSearchJson,
  type RecallToolContext
} from '../recall/tools.js'
import type { RecallDoctorStats, RecallHit, RecallIngestResult, RecallTurn } from '../recall/types.js'
import { CancelledError } from '../core/errors.js'
import { pathExists } from '../core/fs.js'
import { getHomeDir, getProjectPaths } from '../core/paths.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'

export interface RecallCliOptions extends RecallToolContext {
  json: boolean
}

export interface RecallInstallCliOptions extends RecallCliOptions {
  yes: boolean
  nonInteractive: boolean
  env?: NodeJS.ProcessEnv
}

function emitJson(data: unknown): void {
  ui.json(data)
}

function printUnknown(json: boolean, data: unknown): void {
  if (json) {
    emitJson(data)
    return
  }
  ui.writeln(JSON.stringify(data, null, 2))
}

function formatHit(hit: RecallHit): string {
  const when = hit.timestamp ?? '-'
  const project = hit.project ?? '-'
  const quote = hit.quote.replace(/\s+/g, ' ')
  return `${hit.provider}  ${hit.sessionId}#${hit.turn}  ${when}  ${project}\n  ${quote}`
}

function printSearch(json: boolean, payload: RecallSearchJson): void {
  if (json) {
    emitJson(payload)
    return
  }
  if (payload.hits.length === 0) {
    ui.info('No matching turns.')
    return
  }
  ui.keyValue('Query', payload.query)
  ui.keyValue('Scope', payload.all ? 'all' : (payload.project ?? 'project'))
  ui.keyValue('Hits', String(payload.hits.length))
  ui.blank()
  for (const hit of payload.hits) {
    ui.writeln(formatHit(hit))
    ui.blank()
  }
}

function printTurn(json: boolean, sessionId: string, turn: number, payload: RecallTurn | null): void {
  if (json) {
    emitJson(payload)
    return
  }
  if (!payload) {
    ui.info(`Turn not found: ${sessionId}#${turn}`)
    return
  }
  ui.keyValue('Provider', payload.provider)
  ui.keyValue('Session', payload.sessionId)
  ui.keyValue('Turn', String(payload.turn))
  ui.keyValue('Role', payload.role)
  ui.keyValue('When', payload.timestamp ?? '-')
  ui.keyValue('Project', payload.project ?? '-')
  ui.blank()
  ui.writeln(payload.text)
}

function printDoctor(json: boolean, stats: RecallDoctorStats): void {
  if (json) {
    emitJson(stats)
    return
  }
  ui.keyValue('Index', stats.indexPath)
  ui.keyValue('Files', String(stats.files))
  ui.keyValue('Turns', String(stats.turns))
  ui.keyValue('Redacted', String(stats.redacted))
  ui.keyValue('Subagents', String(stats.skippedSubagents))
  ui.keyValue('WAL', stats.wal ? 'yes' : 'no')
  ui.blank()
  for (const [provider, counts] of Object.entries(stats.providers)) {
    ui.writeln(`  ${provider.padEnd(10)} ${counts.files} files, ${counts.turns} turns`)
  }
}

function printIngest(json: boolean, result: RecallIngestResult, rebuilt: boolean): void {
  if (json) {
    emitJson(result)
    return
  }
  const verb = rebuilt ? 'Reindexed' : 'Indexed'
  ui.success(
    `${verb} ${result.filesIndexed} files (${result.turnsIndexed} turns), ${result.redacted} redacted, ${result.filesUnchanged} unchanged, ${result.filesRemoved} removed.`
  )
  if (result.errors.length > 0) {
    ui.warning(`${result.errors.length} ingest error(s). Re-run with --json for paths.`)
  }
}

/** Person shelves from indexed sessions. */
export async function runRecallAbout(options: RecallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const data = await recallAbout(options)
  printUnknown(options.json, data)
}

/** What indexed sessions say about the current project. */
export async function runRecallProject(options: RecallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const data = await recallProject(options)
  printUnknown(options.json, data)
}

/** Search indexed user/assistant speech. */
export async function runRecallSearch(
  options: RecallCliOptions & { query: string; limit?: number; all?: boolean; project?: string }
): Promise<void> {
  ui.setContext({ json: options.json })
  const payload = await recallSearch(options.query, options)
  printSearch(options.json, payload)
}

/** Re-read one turn from the original transcript. */
export async function runRecallGet(options: RecallCliOptions & { sessionId: string; turn: number }): Promise<void> {
  ui.setContext({ json: options.json })
  const payload = await recallGet(options.sessionId, options.turn, options)
  printTurn(options.json, options.sessionId, options.turn, payload)
}

/** Index health: file/turn counts and redacted secrets. */
export async function runRecallDoctor(options: RecallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const stats = await recallDoctor(options)
  printDoctor(options.json, stats)
}

/** Incrementally index local agent sessions. */
export async function runRecallIngest(options: RecallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const result = await ingest({
    indexPath: options.indexPath,
    homeDir: options.homeDir
  })
  printIngest(options.json, result, false)
}

/** Rebuild the recall index from scratch. */
export async function runRecallReindex(options: RecallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const result = await reindex({
    indexPath: options.indexPath,
    homeDir: options.homeDir
  })
  printIngest(options.json, result, true)
}

function printInstall(json: boolean, result: RecallInstallResult): void {
  if (json) {
    emitJson({
      homeDir: result.homeDir,
      initialized: result.initialized,
      skillPath: result.skillPath,
      indexPath: result.indexPath,
      mcp: result.mcp,
      ingest: result.ingest,
      sync: result.sync
    })
    return
  }

  ui.success('Recall installed for this machine.')
  ui.keyValue('Home', result.homeDir)
  ui.keyValue('Index', result.indexPath)
  ui.keyValue('Skill', result.skillPath)
  ui.keyValue('MCP', result.mcp.name)
  ui.keyValue('Files', String(result.ingest.filesIndexed))
  ui.keyValue('Turns', String(result.ingest.turnsIndexed))
  if (result.initialized) {
    ui.info('Initialized ~/.agents (global).')
  }
  if (result.ingest.errors.length > 0) {
    ui.warning(`${result.ingest.errors.length} ingest error(s). Re-run with --json for paths.`)
  }
  const warningBlock = formatWarnings(result.sync.warnings, 4)
  if (warningBlock) {
    ui.blank()
    for (const line of warningBlock.split('\n').filter(Boolean)) {
      if (line.startsWith('- ')) {
        ui.warning(line.slice(2))
      }
    }
  }
  ui.hint('Try agents recall about --json')
}

/** Index sessions, install the recall skill and MCP into ~/.agents, then sync globally. */
export async function runRecallInstall(options: RecallInstallCliOptions): Promise<void> {
  ui.setContext({ json: options.json })
  const homeDir = options.homeDir ?? getHomeDir()
  const skipPrompt = options.yes || options.nonInteractive || options.json

  if (!skipPrompt) {
    const paths = getProjectPaths(homeDir)
    const exists = await pathExists(paths.agentsConfig)
    const message = exists
      ? `Install recall into ${paths.agentsDir} and sync to enabled tools?`
      : `Initialize ${paths.agentsDir}, install recall, and sync to all tools?`
    const proceed = await ui.clack.confirm({
      message,
      initialValue: true
    })
    if (ui.clack.isCancel(proceed) || proceed !== true) {
      ui.clack.cancel('Canceled.')
      throw new CancelledError()
    }
  }

  const spin = ui.spinner()
  spin.start('Installing recall...')
  try {
    const result = await installRecall(
      {
        homeDir,
        indexPath: options.indexPath,
        env: options.env
      },
      (message) => spin.message(message),
    )
    spin.stop('Recall installed')
    printInstall(options.json, result)
  } catch (error) {
    spin.stop('Recall install failed')
    throw error
  }
}

/** Serve `about`, `project`, `search`, and `get` over MCP stdio. */
export async function runRecallMcp(): Promise<void> {
  await runRecallMcpServer()
}
