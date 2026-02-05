import type { McpServerDefinition } from '../types.js'

const PLACEHOLDER_PATTERN = /^\$\{[A-Z0-9_]+\}$/
const SECRET_KEY_PATTERN = /(secret|token|api[_-]?key|password|passphrase|authorization|auth|bearer)/i
const SECRET_VALUE_PATTERN = /^(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{10,})/
const SECRET_TEMPLATE_PATTERN =
  /(^\$\{[A-Z0-9_]+\}$|^ghp_x+$|^x{3,}$|token[_-]?here|your[_-]?(token|api[_-]?key|secret)|replace[_-]?me|changeme|example|placeholder|dummy|sample|<[^>]*(token|api[_-]?key|secret)[^>]*>$)/i
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

export function isLikelyTemplateSecretValue(value: string): boolean {
  if (!value) return true
  return SECRET_TEMPLATE_PATTERN.test(value)
}

export function isSecretArgFlag(flag: string): boolean {
  return SECRET_ARG_FLAG_PATTERN.test(flag)
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
  secretEnvKeys?: string[]
  secretHeaderKeys?: string[]
  secretArgIndexes?: number[]
}): SecretSplitResult {
  const publicServer: McpServerDefinition = JSON.parse(JSON.stringify(input.server)) as McpServerDefinition
  const localOverride: Partial<McpServerDefinition> = {}

  const secretEnv = input.secretEnv ?? {}
  const secretEnvKeys = new Set<string>([...Object.keys(secretEnv), ...(input.secretEnvKeys ?? [])])
  if (secretEnvKeys.size > 0) {
    publicServer.env = { ...(publicServer.env ?? {}) }
    const localEnv: Record<string, string> = {}
    for (const key of [...secretEnvKeys].sort((a, b) => a.localeCompare(b))) {
      publicServer.env[key] = toPlaceholder(input.name, `env_${key}`, key)
      if (Object.prototype.hasOwnProperty.call(secretEnv, key)) {
        localEnv[key] = secretEnv[key]
      }
    }
    if (Object.keys(localEnv).length > 0) {
      localOverride.env = localEnv
    }
  }

  const secretHeaders = input.secretHeaders ?? {}
  const secretHeaderKeys = new Set<string>([...Object.keys(secretHeaders), ...(input.secretHeaderKeys ?? [])])
  if (secretHeaderKeys.size > 0) {
    publicServer.headers = { ...(publicServer.headers ?? {}) }
    const localHeaders: Record<string, string> = {}
    for (const key of [...secretHeaderKeys].sort((a, b) => a.localeCompare(b))) {
      publicServer.headers[key] = toPlaceholder(input.name, `header_${key}`)
      if (Object.prototype.hasOwnProperty.call(secretHeaders, key)) {
        localHeaders[key] = secretHeaders[key]
      }
    }
    if (Object.keys(localHeaders).length > 0) {
      localOverride.headers = localHeaders
    }
  }

  const secretArgValues = new Map<number, string>()
  for (const entry of input.secretArgs ?? []) {
    secretArgValues.set(entry.index, entry.value)
  }
  const secretArgIndexes = new Set<number>([
    ...secretArgValues.keys(),
    ...(input.secretArgIndexes ?? [])
  ])
  if (secretArgIndexes.size > 0) {
    if (!publicServer.args || publicServer.args.length === 0) {
      throw new Error('Cannot apply secret args to a server without args.')
    }
    const secretIndexesSorted = [...secretArgIndexes].sort((a, b) => a - b)
    const localArgs = [...publicServer.args]
    let hasLocalArgValues = false
    for (const index of secretIndexesSorted) {
      if (index < 0 || index >= publicServer.args.length) {
        throw new Error(`Secret arg index ${String(index)} is out of bounds for server "${input.name}".`)
      }
      publicServer.args[index] = toPlaceholder(input.name, `arg_${String(index)}`)
      localArgs[index] = publicServer.args[index]
      if (secretArgValues.has(index)) {
        localArgs[index] = secretArgValues.get(index) as string
        hasLocalArgValues = true
      }
    }
    if (hasLocalArgValues) {
      localOverride.args = localArgs
    }
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
