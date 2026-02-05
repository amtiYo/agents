import type { AgentsConfig, IntegrationName, McpTransportType } from '../types.js'
import { INTEGRATION_IDS, parseIntegrationList } from '../integrations/registry.js'

const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_\-:.]+$/
const TRANSPORTS: McpTransportType[] = ['stdio', 'http', 'sse']

export function validateServerName(name: string): void {
  if (!name.trim()) {
    throw new Error('MCP server name cannot be empty.')
  }
  if (!SERVER_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid server name "${name}": must contain only alphanumeric characters, hyphens, underscores, colons, and dots`,
    )
  }
  if (name.includes('..')) {
    throw new Error(`Invalid server name "${name}": cannot contain ".."`)
  }
}

export function validateTransport(transport: string): McpTransportType {
  if (!TRANSPORTS.includes(transport as McpTransportType)) {
    throw new Error(`Unsupported MCP transport "${transport}". Allowed: ${TRANSPORTS.join(', ')}`)
  }
  return transport as McpTransportType
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
    warning: 'No integrations are enabled; defaulting MCP targets to all integrations.'
  }
}

export function validateEnvValueForShell(key: string, value: string, context: string): void {
  if (/[`$\\;|&<>(){}[\]!\n\r]/.test(value)) {
    throw new Error(`Invalid ${context} value for "${key}": contains potentially dangerous characters`)
  }
  if (/[\x00-\x1F\x7F]/.test(value)) {
    throw new Error(`Invalid ${context} value for "${key}": contains control characters`)
  }
}
