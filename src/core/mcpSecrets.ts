import type { McpServerDefinition } from '../types.js'

const PLACEHOLDER_PATTERN = /^\$\{[A-Z0-9_]+\}$/
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|password|passphrase|authorization|auth|bearer)/i
const SECRET_VALUE_PATTERN = /^(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,})/
const SECRET_ARG_FLAG_PATTERN = /^--?(api[-_]?key|token|secret|password|passphrase|auth|authorization)$/i

interface SecretArg {
  index: number
  value: string
}

export interface SecretSplitResult {
  publicServer: McpServerDefinition
  localOverride: Partial<McpServerDefinition>
}

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value)
}

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

export function isSecretLikeLiteral(value: string): boolean {
  if (!value || isPlaceholderValue(value)) return false
  if (value.length >= 24 && !value.includes(' ')) return true
  return SECRET_VALUE_PATTERN.test(value)
}

export function inferSecretArgs(args: string[]): number[] {
  const secretIndexes: number[] = []
  for (let i = 0; i < args.length - 1; i += 1) {
    if (!SECRET_ARG_FLAG_PATTERN.test(args[i])) continue
    const value = args[i + 1]
    if (value.startsWith('-')) continue
    if (isPlaceholderValue(value)) continue
    secretIndexes.push(i + 1)
  }
  return [...new Set(secretIndexes)].sort((a, b) => a - b)
}

export function inferSecretKeyValues(values: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!isSecretLikeKey(key)) continue
    if (isPlaceholderValue(value)) continue
    out[key] = value
  }
  return out
}

export function splitServerSecrets(input: {
  name: string
  server: McpServerDefinition
  secretEnv?: Record<string, string>
  secretHeaders?: Record<string, string>
  secretArgs?: SecretArg[]
}): SecretSplitResult {
  const publicServer: McpServerDefinition = JSON.parse(JSON.stringify(input.server)) as McpServerDefinition
  const localOverride: Partial<McpServerDefinition> = {}

  const secretEnv = input.secretEnv ?? {}
  if (Object.keys(secretEnv).length > 0) {
    publicServer.env = { ...(publicServer.env ?? {}) }
    localOverride.env = {}
    for (const [key, value] of Object.entries(secretEnv)) {
      publicServer.env[key] = toPlaceholder(input.name, `env_${key}`, key)
      localOverride.env[key] = value
    }
  }

  const secretHeaders = input.secretHeaders ?? {}
  if (Object.keys(secretHeaders).length > 0) {
    publicServer.headers = { ...(publicServer.headers ?? {}) }
    localOverride.headers = {}
    for (const [key, value] of Object.entries(secretHeaders)) {
      publicServer.headers[key] = toPlaceholder(input.name, `header_${key}`)
      localOverride.headers[key] = value
    }
  }

  const secretArgs = input.secretArgs ?? []
  if (secretArgs.length > 0) {
    if (!publicServer.args || publicServer.args.length === 0) {
      throw new Error('Cannot apply secret args to a server without args.')
    }
    const localArgs = [...publicServer.args]
    for (const entry of secretArgs) {
      if (entry.index < 0 || entry.index >= publicServer.args.length) {
        throw new Error(`Secret arg index ${String(entry.index)} is out of bounds for server "${input.name}".`)
      }
      publicServer.args[entry.index] = toPlaceholder(input.name, `arg_${String(entry.index)}`)
      localArgs[entry.index] = entry.value
    }
    localOverride.args = localArgs
  }

  return {
    publicServer,
    localOverride: cleanupEmptyOverride(localOverride)
  }
}

function cleanupEmptyOverride(override: Partial<McpServerDefinition>): Partial<McpServerDefinition> {
  const out: Partial<McpServerDefinition> = { ...override }
  if (out.env && Object.keys(out.env).length === 0) delete out.env
  if (out.headers && Object.keys(out.headers).length === 0) delete out.headers
  if (out.args && out.args.length === 0) delete out.args
  return out
}

function toPlaceholder(serverName: string, suffix: string, preferredName?: string): string {
  if (preferredName && /^[A-Z_][A-Z0-9_]*$/.test(preferredName)) {
    return `\${${preferredName}}`
  }
  const variable = `MCP_${sanitizeToken(serverName)}_${sanitizeToken(suffix)}`
  return `\${${variable}}`
}

function sanitizeToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}
