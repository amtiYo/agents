import * as clack from '@clack/prompts'
import type { IntegrationName, McpServerDefinition } from '../types.js'
import { loadAgentsConfig } from '../core/config.js'
import { parseImportedServers, readImportInput } from '../core/mcpImport.js'
import { upsertMcpServers } from '../core/mcpCrud.js'
import {
  inferSecretArgs,
  inferSecretKeyValues,
  isLikelyTemplateSecretValue,
  isPlaceholderValue,
  isSecretArgFlag,
  isSecretLikeKey,
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
  promptSecretValue?: (message: string) => Promise<string>
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

  const shouldPromptSecrets = !options.nonInteractive && (
    Boolean(options.promptSecretValue)
    || (process.stdin.isTTY && process.stdout.isTTY)
  )
  const updates = []
  for (const entry of imported) {
    validateServerName(entry.name)
    const baseServer: McpServerDefinition = {
      ...entry.server,
      targets: resolveTargets(entry.server.targets, targetOverride, defaultTargets.targets)
    }

    const secretEnv = inferSecretKeyValues(baseServer.env)
    const secretEnvKeys = new Set<string>(Object.keys(secretEnv))
    const secretHeaders = inferSecretKeyValues(baseServer.headers)
    const secretHeaderKeys = new Set<string>(Object.keys(secretHeaders))
    const secretArgs = inferSecretArgs(baseServer.args ?? []).map((index) => ({
      index,
      value: (baseServer.args ?? [])[index]
    }))
    const secretArgIndexes = new Set<number>(secretArgs.map((entry) => entry.index))

    if (shouldPromptSecrets) {
      const prompted = await promptForOptionalSecrets({
        name: entry.name,
        server: baseServer,
        secretEnv,
        secretEnvKeys,
        secretHeaders,
        secretHeaderKeys,
        secretArgs,
        secretArgIndexes,
        promptSecretValue: options.promptSecretValue ?? promptSecretInput
      })
      warnings.push(...prompted.warnings)
    }

    const split = splitServerSecrets({
      name: entry.name,
      server: baseServer,
      secretEnv,
      secretHeaders,
      secretArgs,
      secretEnvKeys: [...secretEnvKeys],
      secretHeaderKeys: [...secretHeaderKeys],
      secretArgIndexes: [...secretArgIndexes]
    })

    updates.push({
      name: entry.name,
      server: split.publicServer,
      localOverride: split.localOverride
    })
  }

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

interface PromptSecretsArgs {
  name: string
  server: McpServerDefinition
  secretEnv: Record<string, string>
  secretEnvKeys: Set<string>
  secretHeaders: Record<string, string>
  secretHeaderKeys: Set<string>
  secretArgs: Array<{ index: number; value: string }>
  secretArgIndexes: Set<number>
  promptSecretValue: (message: string) => Promise<string>
}

async function promptForOptionalSecrets(args: PromptSecretsArgs): Promise<{ warnings: string[] }> {
  const skipped: string[] = []

  const envCandidates = getTemplateSecretEnvKeys(args.server)
  for (const key of envCandidates) {
    args.secretEnvKeys.add(key)
    const entered = await args.promptSecretValue(`Secret for "${args.name}" env "${key}" (optional, Enter to skip)`)
    if (entered.length > 0) {
      args.secretEnv[key] = entered
      continue
    }
    delete args.secretEnv[key]
    skipped.push(`env:${key}`)
  }

  const headerCandidates = getTemplateSecretHeaderKeys(args.server)
  for (const key of headerCandidates) {
    args.secretHeaderKeys.add(key)
    const entered = await args.promptSecretValue(`Secret for "${args.name}" header "${key}" (optional, Enter to skip)`)
    if (entered.length > 0) {
      args.secretHeaders[key] = entered
      continue
    }
    delete args.secretHeaders[key]
    skipped.push(`header:${key}`)
  }

  const secretArgMap = new Map<number, string>(args.secretArgs.map((entry) => [entry.index, entry.value]))
  const secretArgCandidates = getTemplateSecretArgIndexes(args.server)
  for (const index of secretArgCandidates) {
    args.secretArgIndexes.add(index)
    const flag = args.server.args?.[index - 1]
    const label = flag ? `arg #${String(index)} (${flag})` : `arg #${String(index)}`
    const entered = await args.promptSecretValue(`Secret for "${args.name}" ${label} (optional, Enter to skip)`)
    if (entered.length > 0) {
      secretArgMap.set(index, entered)
      continue
    }
    secretArgMap.delete(index)
    skipped.push(`arg:${String(index)}`)
  }
  args.secretArgs.splice(0, args.secretArgs.length, ...[...secretArgMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, value]) => ({ index, value })))

  if (skipped.length === 0) return { warnings: [] }
  return {
    warnings: [
      `MCP server "${args.name}" has skipped secret values (${skipped.join(', ')}). Add them later in .agents/local.json.`,
    ]
  }
}

function getTemplateSecretEnvKeys(server: McpServerDefinition): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (!isSecretLikeKey(key)) continue
    if (!isTemplateOrPlaceholderSecret(value)) continue
    out.push(key)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function getTemplateSecretHeaderKeys(server: McpServerDefinition): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (!isSecretLikeKey(key)) continue
    if (!isTemplateOrPlaceholderSecret(value)) continue
    out.push(key)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function getTemplateSecretArgIndexes(server: McpServerDefinition): number[] {
  const args = server.args ?? []
  const out = new Set<number>()
  for (let i = 0; i < args.length - 1; i += 1) {
    const flag = args[i]
    const value = args[i + 1]
    if (!isSecretArgFlag(flag)) continue
    if (value.startsWith('-')) continue
    if (!isTemplateOrPlaceholderSecret(value)) continue
    out.add(i + 1)
  }
  return [...out].sort((a, b) => a - b)
}

function isTemplateOrPlaceholderSecret(value: string): boolean {
  return isPlaceholderValue(value) || isLikelyTemplateSecretValue(value)
}

async function promptSecretInput(message: string): Promise<string> {
  const value = await clack.password({
    message,
    mask: '•'
  })
  if (clack.isCancel(value)) {
    clack.cancel('Canceled.')
    process.exit(1)
  }
  return String(value ?? '').trim()
}
