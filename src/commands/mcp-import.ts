import type { IntegrationName, McpServerDefinition } from '../types.js'
import { loadAgentsConfig } from '../core/config.js'
import { parseImportedServers, readImportInput } from '../core/mcpImport.js'
import { upsertMcpServers } from '../core/mcpCrud.js'
import {
  inferSecretArgs,
  inferSecretKeyValues,
  splitServerSecrets
} from '../core/mcpSecrets.js'
import { parseTargetOptions, resolveDefaultTargets, validateServerName } from '../core/mcpValidation.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'

export interface McpImportOptions {
  projectRoot: string
  file?: string
  json?: string
  url?: string
  name?: string
  targets?: string[]
  replace: boolean
  noSync: boolean
  nonInteractive: boolean
}

export async function runMcpImport(options: McpImportOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)
  const payload = await readImportInput({
    filePath: options.file,
    jsonText: options.json,
    url: options.url
  })
  const imported = parseImportedServers(payload, options.name)
  const targetOverride = parseTargetOptions(options.targets)
  const defaultTargets = resolveDefaultTargets(config)
  const warnings: string[] = []
  if (targetOverride.length === 0 && defaultTargets.warning) {
    warnings.push(defaultTargets.warning)
  }

  const updates = imported.map((entry) => {
    validateServerName(entry.name)
    const baseServer: McpServerDefinition = {
      ...entry.server,
      targets: resolveTargets(entry.server.targets, targetOverride, defaultTargets.targets)
    }

    const secretEnv = inferSecretKeyValues(baseServer.env)
    const secretHeaders = inferSecretKeyValues(baseServer.headers)
    const secretArgs = inferSecretArgs(baseServer.args ?? []).map((index) => ({
      index,
      value: (baseServer.args ?? [])[index]
    }))

    const split = splitServerSecrets({
      name: entry.name,
      server: baseServer,
      secretEnv,
      secretHeaders,
      secretArgs
    })

    return {
      name: entry.name,
      server: split.publicServer,
      localOverride: split.localOverride
    }
  })

  const result = await upsertMcpServers({
    projectRoot: options.projectRoot,
    updates,
    replace: options.replace
  })

  if (!options.noSync) {
    const sync = await performSync({
      projectRoot: options.projectRoot,
      check: false,
      verbose: false
    })
    warnings.push(...sync.warnings)
  }

  process.stdout.write(
    `Imported MCP servers: ${updates.length} (created: ${String(result.created.length)}, updated: ${String(result.updated.length)})\n`,
  )
  if (result.created.length > 0) {
    process.stdout.write(`Created: ${result.created.join(', ')}\n`)
  }
  if (result.updated.length > 0) {
    process.stdout.write(`Updated: ${result.updated.join(', ')}\n`)
  }
  if (options.noSync) {
    process.stdout.write('Skipped sync (--no-sync).\n')
  }
  const warningBlock = formatWarnings(warnings, 4)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
}

function resolveTargets(
  existing: IntegrationName[] | undefined,
  override: IntegrationName[],
  defaults: IntegrationName[],
): IntegrationName[] {
  if (override.length > 0) return override
  if (existing && existing.length > 0) return existing
  return defaults
}
