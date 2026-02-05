import { readFile } from 'node:fs/promises'
import { parse, type ParseError } from 'jsonc-parser'
import type { McpServerDefinition, McpTransportType } from '../types.js'
import { parseTargetOptions, validateTransport } from './mcpValidation.js'

interface ImportedServer {
  name: string
  server: McpServerDefinition
}

const SERVER_FIELD_HINTS = new Set([
  'transport',
  'type',
  'command',
  'args',
  'arguments',
  'url',
  'headers',
  'env',
  'cwd',
  'requiredEnv',
  'targets',
  'enabled',
  'description',
  'label'
])

export async function readImportInput(args: {
  filePath?: string
  jsonText?: string
  url?: string
}): Promise<string> {
  const provided = [args.filePath, args.jsonText, args.url].filter(Boolean).length
  if (provided > 1) {
    throw new Error('Use only one input source: --file, --json, or --url.')
  }
  if (args.filePath) {
    if (isHttpUrl(args.filePath)) {
      throw new Error('Option --file expects a local file path. For web pages use --url.')
    }
    return readFile(args.filePath, 'utf8')
  }
  if (args.jsonText) {
    return args.jsonText
  }
  if (args.url) {
    return readImportInputFromUrl(args.url)
  }
  if (process.stdin.isTTY) {
    throw new Error('No import payload provided. Use --file, --json, --url, or pipe JSON/JSONC via stdin.')
  }
  return readStdinAll()
}

export function parseImportedServers(rawInput: string, explicitName?: string): ImportedServer[] {
  const raw = parseJsonc(rawInput)
  const serversFromContainer = extractServerContainer(raw)

  let imported: ImportedServer[]
  if (serversFromContainer) {
    imported = Object.entries(serversFromContainer).map(([name, value]) => ({
      name,
      server: normalizeServerDefinition(value, name)
    }))
  } else if (isObject(raw) && looksLikeServerDefinition(raw)) {
    const nameFromPayload = typeof raw.name === 'string' ? raw.name : undefined
    const resolvedName = explicitName ?? nameFromPayload
    if (!resolvedName) {
      throw new Error('Single-server import requires --name when payload does not include "name".')
    }
    imported = [
      {
        name: resolvedName,
        server: normalizeServerDefinition(raw, resolvedName)
      }
    ]
  } else {
    throw new Error(
      'Unsupported import shape. Allowed: {mcp:{servers}}, {mcpServers}, {servers}, {<name>:{...server...}}, or single server object.',
    )
  }

  if (imported.length === 0) {
    throw new Error('Import payload contains no MCP servers.')
  }

  if (explicitName) {
    if (imported.length !== 1) {
      throw new Error('--name can only be used when importing exactly one server.')
    }
    imported[0].name = explicitName
  }

  return imported
}

function normalizeServerDefinition(value: unknown, serverName: string): McpServerDefinition {
  if (!isObject(value)) {
    throw new Error(`Server "${serverName}" must be a JSON object.`)
  }

  const commandOrArray = value.command
  const args = readStringArray(value.args ?? value.arguments, `${serverName}.args`)
  let command: string | undefined
  let normalizedArgs: string[] | undefined = args

  if (typeof commandOrArray === 'string') {
    command = commandOrArray
  } else if (Array.isArray(commandOrArray)) {
    const commandArray = readStringArray(commandOrArray, `${serverName}.command`) ?? []
    if (commandArray.length === 0) {
      throw new Error(`Server "${serverName}" command array cannot be empty.`)
    }
    command = commandArray[0]
    normalizedArgs = normalizedArgs ?? commandArray.slice(1)
  } else if (commandOrArray !== undefined) {
    throw new Error(`Server "${serverName}" command must be a string or string array.`)
  }

  const url = readOptionalString(value.url, `${serverName}.url`)

  const transportRaw = readOptionalString(value.transport, `${serverName}.transport`)
    ?? readOptionalString(value.type, `${serverName}.type`)
    ?? inferTransport(command, url)
  const transport = validateTransport(transportRaw)

  const out: McpServerDefinition = {
    transport
  }

  if (typeof value.label === 'string') out.label = value.label
  if (typeof value.description === 'string') out.description = value.description
  if (typeof value.enabled === 'boolean') out.enabled = value.enabled
  if (typeof value.cwd === 'string') out.cwd = value.cwd

  const targetsRaw = value.targets
  if (Array.isArray(targetsRaw)) {
    out.targets = parseTargetOptions(targetsRaw.map((entry) => String(entry)))
  } else if (typeof targetsRaw === 'string') {
    out.targets = parseTargetOptions([targetsRaw])
  } else if (targetsRaw !== undefined) {
    throw new Error(`Server "${serverName}" targets must be an array or comma-separated string.`)
  }

  const requiredEnv = readStringArray(value.requiredEnv, `${serverName}.requiredEnv`)
  if (requiredEnv && requiredEnv.length > 0) {
    out.requiredEnv = requiredEnv
  }

  if (transport === 'stdio') {
    if (!command) {
      throw new Error(`Server "${serverName}" must include command for stdio transport.`)
    }
    out.command = command
    if (normalizedArgs && normalizedArgs.length > 0) out.args = normalizedArgs
  } else {
    if (!url) {
      throw new Error(`Server "${serverName}" must include url for ${transport} transport.`)
    }
    out.url = url
  }

  const env = readStringMap(value.env, `${serverName}.env`)
  if (Object.keys(env).length > 0) out.env = env

  const headers = readStringMap(value.headers, `${serverName}.headers`)
  if (Object.keys(headers).length > 0) out.headers = headers

  return out
}

function inferTransport(command: string | undefined, url: string | undefined): McpTransportType {
  if (command) return 'stdio'
  if (url) return 'http'
  throw new Error('Cannot infer transport: provide transport/type, command, or url.')
}

function extractServerContainer(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null
  if (isObject(value.mcp) && isObject(value.mcp.servers)) {
    return value.mcp.servers
  }
  if (isObject(value.mcpServers)) {
    return value.mcpServers
  }
  if (isObject(value.servers)) {
    return value.servers
  }
  // Also support plain map style: { "<name>": { ...server fields... } }
  const entries = Object.entries(value)
  if (
    entries.length > 0
    && entries.every(([, entryValue]) => isObject(entryValue) && looksLikeServerDefinition(entryValue))
  ) {
    return value
  }
  return null
}

function parseJsonc(rawInput: string): unknown {
  const errors: ParseError[] = []
  const parsed = parse(rawInput, errors, {
    allowTrailingComma: true,
    disallowComments: false
  })
  if (errors.length > 0) {
    throw new Error(`Invalid JSON/JSONC import payload (${errors.length} parse error(s)).`)
  }
  return parsed
}

function looksLikeServerDefinition(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => SERVER_FIELD_HINTS.has(key))
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`Field "${label}" must be a string.`)
  }
  return value
}

function readStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`Field "${label}" must be an array of strings.`)
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error(`Field "${label}" must be an array of strings.`)
    }
  }
  return [...value]
}

function readStringMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (!isObject(value)) {
    throw new Error(`Field "${label}" must be an object of string values.`)
  }
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new Error(`Field "${label}.${key}" must be a string.`)
    }
    out[key] = entry
  }
  return out
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readStdinAll(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    process.stdin.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    process.stdin.on('error', reject)
  })
}

async function readImportInputFromUrl(url: string): Promise<string> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }

  const response = await fetch(parsedUrl, {
    headers: {
      Accept: 'application/json,text/html,application/xhtml+xml'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch import URL (${response.status}): ${url}`)
  }

  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const trimmed = text.trim()

  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return text
  }

  const extracted = extractImportPayloadFromHtml(text)
  if (extracted) {
    return extracted
  }

  const markdownFallback = await extractImportPayloadFromUrlFallback(parsedUrl, text)
  if (markdownFallback) {
    return markdownFallback
  }

  throw new Error(
    'Could not extract MCP JSON payload from URL. Use "agents mcp import --url <url>" for JSON pages, or --json/--file with an explicit snippet.',
  )
}

export function extractImportPayloadFromHtml(html: string): string | null {
  const candidates = [...extractJsonCodeBlocks(html), ...extractNextFlightJsonBlocks(html)]
  for (const candidate of candidates) {
    try {
      parseImportedServers(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

function extractJsonCodeBlocks(html: string): string[] {
  const blocks: string[] = []
  const seen = new Set<string>()
  const jsonRegex = /<code[^>]*class="[^"]*language-jsonc?[^"]*"[^>]*>([\s\S]*?)<\/code>/gi
  for (const match of html.matchAll(jsonRegex)) {
    const raw = match[1]
    if (!raw) continue
    const decoded = decodeHtmlEntities(stripHtmlTags(raw)).trim()
    if (!decoded || seen.has(decoded)) continue
    seen.add(decoded)
    blocks.push(decoded)
  }

  // Some pages publish JSON snippets in plain <pre><code> blocks without language class.
  const genericRegex = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi
  for (const match of html.matchAll(genericRegex)) {
    const raw = match[1]
    if (!raw) continue
    const decoded = decodeHtmlEntities(stripHtmlTags(raw)).trim()
    if (!decoded || seen.has(decoded)) continue
    seen.add(decoded)
    blocks.push(decoded)
  }
  return blocks
}

function extractNextFlightJsonBlocks(html: string): string[] {
  const blocks: string[] = []
  const regex = /"children":"((?:\\.|[^"\\])*)"/g
  for (const match of html.matchAll(regex)) {
    const encoded = match[1]
    if (!encoded) continue

    let decoded = ''
    try {
      decoded = JSON.parse(`"${encoded}"`) as string
    } catch {
      continue
    }

    const trimmed = decoded.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
    blocks.push(trimmed)
  }
  return blocks
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, '')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-fA-F]+);/g, (_full, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_full, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
}

async function extractImportPayloadFromUrlFallback(url: URL, html: string): Promise<string | null> {
  if (!isMcpServersUrl(url)) return null
  const repos = extractGithubReposFromHtml(url, html)
  for (const repo of repos) {
    const markdown = await fetchGithubReadme(repo)
    if (!markdown) continue
    const extracted = extractImportPayloadFromMarkdown(markdown)
    if (extracted) return extracted
  }
  return null
}

export function extractImportPayloadFromMarkdown(markdown: string): string | null {
  const candidates = extractMarkdownJsonCodeBlocks(markdown)
  for (const candidate of candidates) {
    try {
      parseImportedServers(candidate)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

function extractMarkdownJsonCodeBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const regex = /```([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)```/g
  for (const match of markdown.matchAll(regex)) {
    const lang = (match[1] ?? '').trim().toLowerCase()
    const body = (match[2] ?? '').trim()
    if (!body) continue

    const isJsonLang = lang === 'json' || lang === 'jsonc'
    const isLikelyJsonWithoutLang = lang.length === 0 && body.startsWith('{') && body.endsWith('}')
    if (!isJsonLang && !isLikelyJsonWithoutLang) continue

    blocks.push(body)
  }
  return blocks
}

function extractGithubReposFromHtml(url: URL, html: string): Array<{ owner: string; repo: string }> {
  const match = /^\/servers\/([^/]+)\/([^/]+)/.exec(url.pathname)
  const expectedOwner = match?.[1]?.toLowerCase()
  const expectedRepo = normalizeRepoToken(match?.[2] ?? '')

  const unique = new Map<string, { owner: string; repo: string; score: number }>()
  const regex = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g
  for (const found of html.matchAll(regex)) {
    const owner = found[1]
    const repo = found[2]
    if (!owner || !repo) continue
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`
    if (unique.has(key)) continue

    let score = 0
    if (expectedOwner && owner.toLowerCase() === expectedOwner) score += 2
    if (expectedRepo && normalizeRepoToken(repo) === expectedRepo) score += 3
    unique.set(key, { owner, repo, score })
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || a.owner.localeCompare(b.owner) || a.repo.localeCompare(b.repo))
    .map(({ owner, repo }) => ({ owner, repo }))
}

async function fetchGithubReadme(repo: { owner: string; repo: string }): Promise<string | null> {
  const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/readme`
  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github.raw+json'
    }
  })
  if (!response.ok) return null
  return response.text()
}

function isMcpServersUrl(url: URL): boolean {
  return url.hostname === 'mcpservers.org' || url.hostname.endsWith('.mcpservers.org')
}

function normalizeRepoToken(value: string): string {
  return value.replace(/\.git$/i, '').replace(/[^a-z0-9]+/gi, '').toLowerCase()
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
