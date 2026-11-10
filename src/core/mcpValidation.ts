import type { AgentsConfig, IntegrationName, McpTransportType, OpencodeMcpOptions } from '../types.js'
import { INTEGRATION_IDS, parseIntegrationList } from '../integrations/registry.js'

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_\-:.]+$/
const TRANSPORTS: McpTransportType[] = ['stdio', 'http', 'sse']
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_KEY_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const FORBIDDEN_SERVER_NAMES = new Set(['__proto__', 'prototype', 'constructor'])

export function validateServerName(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('MCP server name cannot be empty.')
  }
  if (!SERVER_NAME_PATTERN.test(trimmed)) {
    throw new Error(
      `Invalid server name "${name}": must contain only alphanumeric characters, hyphens, underscores, colons, and dots`,
    )
  }
  if (trimmed.includes('..')) {
    throw new Error(`Invalid server name "${name}": cannot contain ".."`)
  }
  if (FORBIDDEN_SERVER_NAMES.has(trimmed.toLowerCase())) {
    throw new Error(`Invalid server name "${name}": reserved object property name is not allowed`)
  }
}

export function validateTransport(transport: string): McpTransportType {
  const normalized = transport === 'streamable-http' ? 'http' : transport
  if (!TRANSPORTS.includes(normalized as McpTransportType)) {
    throw new Error(`Unsupported MCP transport "${transport}". Allowed: ${TRANSPORTS.join(', ')}`)
  }
  return normalized as McpTransportType
}

export function parseKeyValue(input: string, label: string): { key: string; value: string } {
  const idx = input.indexOf('=')
  if (idx <= 0) {
    throw new Error(`Invalid ${label} "${input}". Expected KEY=VALUE.`)
  }
  const key = input.slice(0, idx).trim()
  const value = input.slice(idx + 1)
  if (!key) {
    throw new Error(`Invalid ${label} "${input}". Key cannot be empty.`)
  }
  return { key, value }
}

export function validateEnvKey(key: string, context = 'environment variable'): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid ${context} key "${key}": must match ${ENV_KEY_PATTERN.toString()}`,
    )
  }
}

export function validateHeaderKey(key: string, context = 'header'): void {
  if (!HEADER_KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid ${context} key "${key}": must match ${HEADER_KEY_PATTERN.toString()}`,
    )
  }
}

export function parseSecretArg(input: string): { index: number; value: string } {
  const parsed = parseKeyValue(input, 'secret arg')
  const index = Number.parseInt(parsed.key, 10)
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid secret arg "${input}". Index must be a non-negative integer.`)
  }
  return { index, value: parsed.value }
}

export function parseTargetOptions(values: string[] | undefined): IntegrationName[] {
  const flattened = (values ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  if (flattened.length === 0) return []
  return parseIntegrationList(flattened.join(','))
}

export function resolveDefaultTargets(config: AgentsConfig): {
  targets: IntegrationName[]
  warning?: string
} {
  if (config.integrations.enabled.length > 0) {
    return { targets: [...new Set(config.integrations.enabled)] }
  }
  return {
    targets: [...INTEGRATION_IDS],
    warning: 'No integrations are enabled; targetless MCP servers remain universal and materialize when integrations are enabled.'
  }
}

export function validateEnvValueForShell(key: string, value: string, context: string): void {
  // Arguments are passed via spawnSync without a shell, so punctuation is safe.
  // We only reject control bytes that can break transport/CLI parsing.
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error(`Invalid ${context} value for "${key}": contains control characters`)
  }
}

/**
 * Reject control characters in a value that is written into a generated config.
 *
 * A newline inside `command` or `cwd` turns a TOML or YAML document into something the
 * tool cannot parse, and the integration then drops out of the sync with an error about
 * a file the user never edited.
 */
export function validateConfigValue(value: string | undefined, label: string, serverName: string): void {
  if (value === undefined) return
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error(`Invalid ${label} in server "${serverName}": contains control characters`)
  }
}

const OPENCODE_OPTION_KEYS = new Set(['disabled', 'codemode', 'pool', 'protocol', 'timeout', 'oauth'])
const OPENCODE_PROTOCOLS = new Set(['legacy', 'auto', '2026-07-28'])
const OPENCODE_TIMEOUT_KEYS = ['startup', 'catalog', 'execution'] as const

/**
 * Validate the `opencode` block of a server and return a clean copy.
 *
 * @throws on an unknown key or a value OpenCode would reject
 */
export function parseOpencodeMcpOptions(value: unknown, serverName: string): OpencodeMcpOptions {
  const where = `server "${serverName}"`
  if (!isPlainObject(value)) throw new Error(`Invalid opencode options in ${where}: expected an object.`)

  for (const key of Object.keys(value)) {
    if (!OPENCODE_OPTION_KEYS.has(key)) throw new Error(`Unknown opencode option "${key}" in ${where}.`)
  }

  const options: OpencodeMcpOptions = {}
  for (const key of ['disabled', 'codemode', 'pool'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'boolean') throw new Error(`opencode.${key} in ${where} must be true or false.`)
    options[key] = value[key]
  }

  if (value.protocol !== undefined) {
    if (typeof value.protocol !== 'string' || !OPENCODE_PROTOCOLS.has(value.protocol)) {
      throw new Error(`opencode.protocol in ${where} must be one of: ${[...OPENCODE_PROTOCOLS].join(', ')}.`)
    }
    options.protocol = value.protocol as OpencodeMcpOptions['protocol']
  }

  // OpenCode accepts an OAuth object too, but credentials live in the shared `oauth`
  // field. Here only `false` is meaningful: it turns off OAuth auto-detection.
  if (value.oauth !== undefined) {
    if (value.oauth !== false) throw new Error(`opencode.oauth in ${where} can only be false; put credentials in "oauth".`)
    options.oauth = false
  }

  if (value.timeout !== undefined) {
    options.timeout = parseOpencodeTimeout(value.timeout, where)
  }

  return options
}

function parseOpencodeTimeout(value: unknown, where: string): NonNullable<OpencodeMcpOptions['timeout']> {
  if (!isPlainObject(value)) throw new Error(`opencode.timeout in ${where} must be an object.`)
  for (const key of Object.keys(value)) {
    if (!(OPENCODE_TIMEOUT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown opencode.timeout field "${key}" in ${where}.`)
    }
  }
  const timeout: NonNullable<OpencodeMcpOptions['timeout']> = {}
  for (const key of OPENCODE_TIMEOUT_KEYS) {
    const item = value[key]
    if (item === undefined) continue
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      throw new Error(`opencode.timeout.${key} in ${where} must be a positive integer (milliseconds).`)
    }
    timeout[key] = item
  }
  return timeout
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
