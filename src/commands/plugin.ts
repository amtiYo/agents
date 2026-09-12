import path from 'node:path'
import { exportPlugin, importPlugin, validatePlugin } from '../core/agentPlugin.js'
import { loadAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import * as ui from '../core/ui.js'

/** Derive a name the Agent Plugins specification accepts from a directory name. */
function toPluginName(directoryName: string): string {
  const slug = directoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const truncated = slug.slice(0, 64).replace(/-+$/, '')
  return truncated.length > 0 ? truncated : 'agents-plugin'
}

export interface PluginExportOptions {
  projectRoot: string
  out?: string
  name?: string
  version?: string
  description?: string
  author?: string
  license?: string
  /** Ship credential-shaped fields that hold literal values instead of refusing. */
  allowLiteralSecrets?: boolean
  json: boolean
}

/** Package the project's MCP servers and skills as an Agent Plugins v1 directory. */
export async function runPluginExport(options: PluginExportOptions): Promise<void> {
  const name = options.name ?? toPluginName(path.basename(path.resolve(options.projectRoot)))
  const outDir = options.out ?? path.join(options.projectRoot, 'dist', 'agent-plugin')

  const result = await exportPlugin({
    projectRoot: options.projectRoot,
    outDir,
    name,
    version: options.version,
    description: options.description,
    author: options.author,
    license: options.license,
    allowLiteralSecrets: options.allowLiteralSecrets
  })

  if (options.json) {
    ui.json(result)
    return
  }

  ui.success(`Plugin written to ${result.outDir}`)
  ui.keyValue('MCP servers', String(result.serverCount))
  ui.keyValue('Skills', String(result.skillCount))
  if (result.requiredEnv.length > 0) {
    ui.keyValue('Required env', ui.formatList(result.requiredEnv))
  }
  for (const warning of result.warnings) {
    ui.warning(warning)
  }
  ui.hint('Install it with the client of your choice, or publish the directory as a git repository.')
}

export interface PluginValidateOptions {
  pluginDir: string
  json: boolean
}

/** Check a plugin directory against the specification and exit non-zero if it fails. */
export async function runPluginValidate(options: PluginValidateOptions): Promise<void> {
  const result = await validatePlugin(options.pluginDir)

  if (options.json) {
    ui.json(result)
    process.exitCode = result.ok ? 0 : 1
    return
  }

  ui.keyValue('MCP servers', String(result.serverCount))
  ui.keyValue('Skills', String(result.skillCount))
  for (const warning of result.warnings) {
    ui.warning(warning)
  }
  if (result.ok) {
    ui.success('Plugin matches the Agent Plugins 1.0.0 specification')
    return
  }
  for (const error of result.errors) {
    ui.error(error)
  }
  process.exitCode = 1
}

export interface PluginImportOptions {
  projectRoot: string
  pluginDir: string
  prefix?: string
  sync: boolean
  json: boolean
}

/** Add the servers and skills of an Agent Plugins package to this project. */
export async function runPluginImport(options: PluginImportOptions): Promise<void> {
  await loadAgentsConfig(options.projectRoot)

  const result = await importPlugin({
    projectRoot: options.projectRoot,
    pluginDir: options.pluginDir,
    prefix: options.prefix
  })

  if (options.sync && (result.addedServers.length > 0 || result.addedSkills.length > 0)) {
    const sync = await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
    result.warnings.push(...sync.warnings)
  }

  if (options.json) {
    ui.json(result)
    return
  }

  if (result.addedServers.length > 0) {
    ui.success(`Added MCP servers: ${ui.formatList(result.addedServers)}`)
  }
  if (result.addedSkills.length > 0) {
    ui.success(`Added skills: ${ui.formatList(result.addedSkills)}`)
  }
  if (result.skippedServers.length > 0) {
    ui.info(`Skipped, already present: ${ui.formatList(result.skippedServers)}`)
  }
  if (result.addedServers.length === 0 && result.addedSkills.length === 0) {
    ui.info('Nothing to import.')
  }
  for (const warning of result.warnings) {
    ui.warning(warning)
  }
}
