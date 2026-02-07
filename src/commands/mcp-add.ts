import * as clack from '@clack/prompts'
import type { Option } from '@clack/prompts'
import type { IntegrationName, McpServerDefinition, McpTransportType } from '../types.js'
import { loadAgentsConfig } from '../core/config.js'
import { upsertMcpServers } from '../core/mcpCrud.js'
import { inferSecretArgs, splitServerSecrets } from '../core/mcpSecrets.js'
import { runMcpImport } from './mcp-import.js'
import {
  parseKeyValue,
  parseSecretArg,
  parseTargetOptions,
  resolveDefaultTargets,
  validateEnvKey,
  validateHeaderKey,
  validateServerName,
  validateTransport
} from '../core/mcpValidation.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import { parseShellWords } from '../core/shellWords.js'

export interface McpAddOptions {
  projectRoot: string
  name?: string
  transport?: string
  command?: string
  args?: string[]
  url?: string
  env?: string[]
  headers?: string[]
  secretEnv?: string[]
  secretHeaders?: string[]
  secretArgs?: string[]
  targets?: string[]
  description?: string
  disabled: boolean
  replace: boolean
  noSync: boolean
  nonInteractive: boolean
}

export async function runMcpAdd(options: McpAddOptions): Promise<void> {
  const nameInput = options.name?.trim()
  if (nameInput && isHttpUrl(nameInput)) {
    ensureNoInlineAddFlagsForUrl(options)
    process.stdout.write(`Detected MCP source URL. Running import flow for ${nameInput}...\n`)
    await runMcpImport({
      projectRoot: options.projectRoot,
      url: nameInput,
      targets: options.targets,
      replace: options.replace,
      noSync: options.noSync,
      nonInteractive: options.nonInteractive
    })
    return
  }

  const config = await loadAgentsConfig(options.projectRoot)

  let name = nameInput ?? ''
  let transport = options.transport ? validateTransport(options.transport) : undefined
  let command = options.command?.trim()
  let url = options.url?.trim()
  let args = [...(options.args ?? [])]

  if (!options.nonInteractive) {
    if (!name) {
      name = await promptText('MCP server name', 'context7')
      if (isHttpUrl(name)) {
        ensureNoInlineAddFlagsForUrl(options)
        process.stdout.write(`Detected MCP source URL. Running import flow for ${name}...\n`)
        await runMcpImport({
          projectRoot: options.projectRoot,
          url: name,
          targets: options.targets,
          replace: options.replace,
          noSync: options.noSync,
          nonInteractive: options.nonInteractive
        })
        return
      }
    }
    if (!transport) {
      const selected = await promptSelect<McpTransportType>('Transport', [
        { label: 'stdio', value: 'stdio' },
        { label: 'http', value: 'http' },
        { label: 'sse', value: 'sse' }
      ])
      transport = selected
    }
    if (transport === 'stdio' && !command) {
      command = await promptText('Command', 'npx')
    }
    if ((transport === 'http' || transport === 'sse') && !url) {
      url = await promptText('URL', 'https://example.com/mcp')
    }
    if (transport === 'stdio' && args.length === 0) {
      const raw = await promptOptionalText('Args (space-separated, optional)')
      args = parseShellWords(raw)
    }
  }

  if (!name) {
    throw new Error('MCP server name is required.')
  }
  validateServerName(name)

  const finalTransport = transport ?? validateTransport('stdio')
  if (finalTransport === 'stdio' && !command) {
    throw new Error('Missing --command for stdio transport.')
  }
  if ((finalTransport === 'http' || finalTransport === 'sse') && !url) {
    throw new Error('Missing --url for http/sse transport.')
  }

  const parsedTargets = parseTargetOptions(options.targets)
  const defaultTargets = resolveDefaultTargets(config)
  const targets: IntegrationName[] = parsedTargets.length > 0 ? parsedTargets : defaultTargets.targets

  const envMap = toMap(options.env, 'env', (key) => validateEnvKey(key, 'environment variable'))
  const headerMap = toMap(options.headers, 'header', (key) => validateHeaderKey(key, 'header'))
  const explicitSecretEnv = toMap(options.secretEnv, 'secret env', (key) => validateEnvKey(key, 'secret environment variable'))
  const explicitSecretHeaders = toMap(options.secretHeaders, 'secret header', (key) => validateHeaderKey(key, 'secret header'))
  const explicitSecretArgs = (options.secretArgs ?? []).map(parseSecretArg)

  if (explicitSecretArgs.length > 0 && args.length === 0) {
    throw new Error('Cannot use --secret-arg without --arg values.')
  }

  const baseServer: McpServerDefinition = {
    transport: finalTransport,
    enabled: !options.disabled,
    targets
  }
  if (options.description?.trim()) {
    baseServer.description = options.description.trim()
  }
  if (finalTransport === 'stdio') {
    baseServer.command = command
    if (args.length > 0) baseServer.args = args
  } else {
    baseServer.url = url
  }
  if (Object.keys(envMap).length > 0) baseServer.env = envMap
  if (Object.keys(headerMap).length > 0) baseServer.headers = headerMap

  const inferredSecretArgIndexes = inferSecretArgs(baseServer.args ?? [])
  const inferredSecretArgs = inferredSecretArgIndexes.map((index) => ({
    index,
    value: (baseServer.args ?? [])[index]
  }))
  const mergedSecretArgs = mergeSecretArgs(explicitSecretArgs, inferredSecretArgs)

  const split = splitServerSecrets({
    name,
    server: baseServer,
    secretEnv: explicitSecretEnv,
    secretHeaders: explicitSecretHeaders,
    secretArgs: mergedSecretArgs
  })

  const upserted = await upsertMcpServers({
    projectRoot: options.projectRoot,
    updates: [
      {
        name,
        server: split.publicServer,
        localOverride: split.localOverride
      }
    ],
    replace: options.replace
  })

  const warnings: string[] = []
  if (!parsedTargets.length && defaultTargets.warning) {
    warnings.push(defaultTargets.warning)
  }

  if (!options.noSync) {
    const sync = await performSync({
      projectRoot: options.projectRoot,
      check: false,
      verbose: false
    })
    warnings.push(...sync.warnings)
  }

  const action = upserted.updated.includes(name) ? 'updated' : 'added'
  process.stdout.write(`MCP server ${action}: ${name}\n`)
  if (options.noSync) {
    process.stdout.write('Skipped sync (--no-sync).\n')
  }
  const warningBlock = formatWarnings(warnings, 4)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
}

function ensureNoInlineAddFlagsForUrl(options: McpAddOptions): void {
  const unsupported: string[] = []
  if (options.transport) unsupported.push('--transport')
  if (options.command) unsupported.push('--command')
  if (options.args && options.args.length > 0) unsupported.push('--arg')
  if (options.url) unsupported.push('--url')
  if (options.env && options.env.length > 0) unsupported.push('--env')
  if (options.headers && options.headers.length > 0) unsupported.push('--header')
  if (options.secretEnv && options.secretEnv.length > 0) unsupported.push('--secret-env')
  if (options.secretHeaders && options.secretHeaders.length > 0) unsupported.push('--secret-header')
  if (options.secretArgs && options.secretArgs.length > 0) unsupported.push('--secret-arg')
  if (options.description?.trim()) unsupported.push('--description')
  if (options.disabled) unsupported.push('--disabled')

  if (unsupported.length > 0) {
    throw new Error(
      `When the positional argument is a URL, manual server flags are not supported (${unsupported.join(', ')}). Use "agents mcp import --url <url>" for advanced control.`,
    )
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function toMap(
  values: string[] | undefined,
  label: string,
  validateKey?: (key: string) => void,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of values ?? []) {
    const parsed = parseKeyValue(entry, label)
    validateKey?.(parsed.key)
    out[parsed.key] = parsed.value
  }
  return out
}

function mergeSecretArgs(primary: Array<{ index: number; value: string }>, fallback: Array<{ index: number; value: string }>) {
  const out = new Map<number, string>()
  for (const item of fallback) {
    out.set(item.index, item.value)
  }
  for (const item of primary) {
    out.set(item.index, item.value)
  }
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, value]) => ({ index, value }))
}

async function promptText(message: string, placeholder: string): Promise<string> {
  const value = await clack.text({
    message,
    placeholder
  })
  if (clack.isCancel(value)) {
    clack.cancel('Canceled.')
    process.exit(1)
  }
  return String(value).trim()
}

async function promptOptionalText(message: string): Promise<string> {
  const value = await clack.text({
    message,
    placeholder: ''
  })
  if (clack.isCancel(value)) {
    clack.cancel('Canceled.')
    process.exit(1)
  }
  return String(value)
}

async function promptSelect<T extends string>(
  message: string,
  options: Array<{ label: string; value: T }>,
): Promise<T> {
  const promptOptions = options.map((entry) => ({
    label: entry.label,
    value: entry.value
  })) as unknown as Option<T>[]
  const value = await clack.select<T>({
    message,
    options: promptOptions
  })
  if (clack.isCancel(value)) {
    clack.cancel('Canceled.')
    process.exit(1)
  }
  return value as T
}
