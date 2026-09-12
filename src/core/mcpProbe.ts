import { spawn } from 'node:child_process'
import { CLI_VERSION } from './version.js'
import type { ResolvedMcpServer } from '../types.js'

/**
 * The revision this client speaks. `2026-07-28` removed the `initialize` handshake and
 * the protocol-level session: every request carries its version, identity and
 * capabilities in `_meta` instead.
 */
const PROTOCOL_VERSION = '2026-07-28'
/** The newest handshake-based revision, used when a server turns out to be legacy. */
const LEGACY_PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'agents-cli', version: CLI_VERSION }

/** Request ids, one per step, so an answer is matched to the step that asked for it. */
const ID_DISCOVER = 1
const ID_MODERN_TOOLS = 2
const ID_LEGACY_INIT = 3
const ID_LEGACY_TOOLS = 4

const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'

/** Error codes the specification reserves, used to tell a modern server from a legacy one. */
const UNSUPPORTED_PROTOCOL_VERSION = -32022
const HEADER_MISMATCH = -32020

/** `_meta` every modern request carries. */
function modernMeta(version: string): Record<string, unknown> {
  return {
    [META_PROTOCOL_VERSION]: version,
    [META_CLIENT_INFO]: CLIENT_INFO,
    [META_CLIENT_CAPABILITIES]: {}
  }
}

/**
 * Pick the version to speak from what a server says it supports.
 *
 * `modern` means this client can send per-request metadata; `legacy` means it has to
 * fall back to the handshake. A server that supports neither is reported as it is.
 */
function chooseVersion(supported: string[] | undefined): { era: 'modern' | 'legacy'; version: string } | undefined {
  if (!supported || supported.length === 0) return undefined
  if (supported.includes(PROTOCOL_VERSION)) return { era: 'modern', version: PROTOCOL_VERSION }
  // Everything before 2026-07-28 is handshake-based; this client speaks one of those.
  const legacy = supported.filter((version) => version < PROTOCOL_VERSION).sort()
  const newestLegacy = legacy.at(-1)
  return newestLegacy ? { era: 'legacy', version: newestLegacy } : undefined
}

/** Versions a server listed in an `UnsupportedProtocolVersionError`. */
function supportedFromError(error: JsonRpcError | undefined): string[] | undefined {
  const data = error?.data
  if (typeof data !== 'object' || data === null) return undefined
  const supported = (data as { supported?: unknown }).supported
  return Array.isArray(supported) ? supported.filter((item): item is string => typeof item === 'string') : undefined
}

/** Whether a JSON-RPC error is one only a modern server returns. */
function isModernError(error: JsonRpcError | undefined): boolean {
  return error?.code === UNSUPPORTED_PROTOCOL_VERSION || error?.code === HEADER_MISMATCH
}

/**
 * A result the client cannot use as a tool list.
 *
 * `resultType` is required from this revision on, and a result missing it comes from an
 * earlier revision and counts as complete.
 */
function inputRequiredError(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const resultType = (result as { resultType?: unknown }).resultType
  return resultType === 'input_required'
    ? 'server asked for additional input, which agents mcp budget cannot provide'
    : undefined
}

export interface ProbedTool {
  name: string
  description: string
  /** Characters of the JSON the client has to hold for this tool. */
  characters: number
}

export interface ProbeResult {
  server: string
  ok: boolean
  tools: ProbedTool[]
  /** Characters of the whole tool list as the client receives it. */
  characters: number
  error?: string
  skipped?: string
}

interface JsonRpcError {
  code?: number
  message?: string
  data?: unknown
}

interface JsonRpcResponse {
  id?: number | string
  method?: string
  result?: unknown
  error?: JsonRpcError
}

/** Size of one tool definition as the client receives it, in characters of JSON. */
function toolCharacters(tool: unknown): number {
  return JSON.stringify(tool ?? {}).length
}

/** Read the tool list out of a `tools/list` result, tolerating malformed entries. */
function extractTools(result: unknown): ProbedTool[] {
  if (typeof result !== 'object' || result === null) return []
  const tools = (result as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return []

  return tools.map((tool) => {
    const entry = (typeof tool === 'object' && tool !== null ? tool : {}) as {
      name?: unknown
      description?: unknown
    }
    return {
      name: typeof entry.name === 'string' ? entry.name : '(unnamed)',
      description: typeof entry.description === 'string' ? entry.description : '',
      characters: toolCharacters(tool)
    }
  })
}

/** Rough token estimate: MCP tool definitions are JSON, which averages about four characters per token. */
export function estimateTokens(characters: number): number {
  return Math.ceil(characters / 4)
}

/**
 * Start a stdio MCP server, run the handshake and read its tool list.
 *
 * The process is always terminated: on success, on protocol error and on timeout.
 */
async function probeStdioServer(server: ResolvedMcpServer, timeoutMs: number): Promise<ProbeResult> {
  if (!server.command) {
    return { server: server.name, ok: false, tools: [], characters: 0, error: 'no command' }
  }

  return new Promise<ProbeResult>((resolve) => {
    const child = spawn(server.command as string, server.args ?? [], {
      cwd: server.cwd,
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let settled = false
    let buffer = ''
    let stderr = ''

    const finish = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      // A server that ignores SIGTERM would otherwise hold the event loop open.
      const hardKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
      hardKill.unref()
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        server: server.name,
        ok: false,
        tools: [],
        characters: 0,
        error: `timed out after ${String(timeoutMs)}ms`
      })
    }, timeoutMs)

    let erasDecided = false

    const finishWithToolsList = (message: JsonRpcResponse): void => {
      if (message.error) {
        finish({
          server: server.name,
          ok: false,
          tools: [],
          characters: 0,
          error: message.error.message ?? 'tools/list failed'
        })
        return
      }
      const pending = inputRequiredError(message.result)
      if (pending) {
        finish({ server: server.name, ok: false, tools: [], characters: 0, error: pending })
        return
      }
      finish({
        server: server.name,
        ok: true,
        tools: extractTools(message.result),
        characters: JSON.stringify(message.result ?? {}).length
      })
    }

    const sendModernToolsList = (version: string): void => {
      erasDecided = true
      clearTimeout(discoveryTimer)
      send({
        jsonrpc: '2.0',
        id: ID_MODERN_TOOLS,
        method: 'tools/list',
        params: { _meta: modernMeta(version) }
      })
    }

    const sendLegacyInitialize = (version: string): void => {
      if (erasDecided) return
      erasDecided = true
      clearTimeout(discoveryTimer)
      send({
        jsonrpc: '2.0',
        id: ID_LEGACY_INIT,
        method: 'initialize',
        params: { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO }
      })
    }

    const send = (message: unknown): void => {
      if (child.stdin.destroyed) return
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    // A command that fails to start reports through the child's own error event; the
    // stdin EPIPE that follows must not become an unhandled error.
    child.stdin.on('error', () => undefined)

    child.on('error', (error: Error) => {
      finish({ server: server.name, ok: false, tools: [], characters: 0, error: error.message })
    })

    child.on('exit', (code) => {
      if (settled) return
      const detail = stderr.trim().split('\n').slice(-1)[0] ?? ''
      finish({
        server: server.name,
        ok: false,
        tools: [],
        characters: 0,
        error: `server exited with code ${String(code ?? -1)}${detail ? `: ${detail}` : ''}`
      })
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
        if (!line) continue

        let message: JsonRpcResponse
        try {
          message = JSON.parse(line) as JsonRpcResponse
        } catch {
          continue
        }

        // A message carrying `method` is a request or notification from the server,
        // not an answer to ours. It also catches processes that merely echo stdin.
        if (typeof message.method === 'string') continue
        if (message.result === undefined && message.error === undefined) continue

        if (message.id === ID_DISCOVER) {
          if (message.error) {
            // Only a modern server answers with one of the reserved codes. Anything
            // else, including "method not found", means the server expects a handshake.
            if (isModernError(message.error)) {
              const choice = chooseVersion(supportedFromError(message.error))
              if (!choice) {
                finish({
                  server: server.name,
                  ok: false,
                  tools: [],
                  characters: 0,
                  error: message.error.message ?? 'server supports no protocol version this CLI speaks'
                })
                return
              }
              if (choice.era === 'modern') {
                sendModernToolsList(choice.version)
              } else {
                sendLegacyInitialize(choice.version)
              }
              continue
            }
            sendLegacyInitialize(LEGACY_PROTOCOL_VERSION)
            continue
          }

          clearTimeout(discoveryTimer)
          const supported = (message.result as { supportedVersions?: unknown } | null)?.supportedVersions
          const choice = chooseVersion(
            Array.isArray(supported) ? supported.filter((item): item is string => typeof item === 'string') : undefined,
          ) ?? { era: 'modern' as const, version: PROTOCOL_VERSION }
          if (choice.era === 'modern') {
            sendModernToolsList(choice.version)
          } else {
            sendLegacyInitialize(choice.version)
          }
          continue
        }

        if (message.id === ID_MODERN_TOOLS) {
          finishWithToolsList(message)
          return
        }

        if (message.id === ID_LEGACY_INIT) {
          if (message.error) {
            finish({
              server: server.name,
              ok: false,
              tools: [],
              characters: 0,
              error: message.error.message ?? 'initialize failed'
            })
            return
          }
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: ID_LEGACY_TOOLS, method: 'tools/list', params: {} })
          continue
        }

        if (message.id === ID_LEGACY_TOOLS) {
          finishWithToolsList(message)
          return
        }
      }
    })

    // A legacy server may ignore server/discover entirely rather than answer it, so the
    // probe gives up early and falls back instead of waiting out the whole timeout.
    const discoveryTimer = setTimeout(() => {
      if (!settled && !erasDecided) sendLegacyInitialize(LEGACY_PROTOCOL_VERSION)
    }, Math.max(500, Math.min(2000, Math.floor(timeoutMs / 3))))
    discoveryTimer.unref()

    send({
      jsonrpc: '2.0',
      id: ID_DISCOVER,
      method: 'server/discover',
      params: { _meta: modernMeta(PROTOCOL_VERSION) }
    })
  })
}

/** Send one JSON-RPC message over HTTP with a timeout, returning the raw body too. */
async function postJsonRpc(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    return { response, text: await response.text() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pull the answer out of a plain JSON body or an SSE stream.
 *
 * A streamable-HTTP server may send notifications before the result, and one SSE event
 * may spread its payload over several `data:` lines, so events are reassembled and
 * anything carrying `method` is skipped.
 */
function parseRpcBody(text: string): JsonRpcResponse | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined

  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse
    } catch {
      return undefined
    }
  }

  const events: string[] = []
  let current: string[] = []
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line === '') {
      if (current.length > 0) events.push(current.join('\n'))
      current = []
      continue
    }
    if (line.startsWith('data:')) {
      current.push(line.slice(5).trimStart())
    }
  }
  if (current.length > 0) events.push(current.join('\n'))

  for (const payload of events) {
    if (!payload) continue
    let message: JsonRpcResponse
    try {
      message = JSON.parse(payload) as JsonRpcResponse
    } catch {
      continue
    }
    if (typeof message.method === 'string') continue
    if (message.result === undefined && message.error === undefined) continue
    return message
  }

  return undefined
}

/**
 * Ask a modern server for its tool list.
 *
 * Every POST carries the version in both the `MCP-Protocol-Version` header and the
 * request `_meta`; a server rejects the request when the two disagree.
 */
async function requestModernToolsList(
  url: string,
  headers: Record<string, string>,
  version: string,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  return postJsonRpc(
    url,
    {
      ...headers,
      'mcp-protocol-version': version,
      'mcp-method': 'tools/list'
    },
    {
      jsonrpc: '2.0',
      id: ID_MODERN_TOOLS,
      method: 'tools/list',
      params: { _meta: modernMeta(version) }
    },
    timeoutMs,
  )
}

/**
 * Read the tool list from a server of the handshake era.
 *
 * Kept for servers built against `2025-11-25` and earlier: they expect `initialize`,
 * may mint a session id, and reject `tools/list` before `notifications/initialized`.
 */
async function probeLegacyHttpServer(
  server: ResolvedMcpServer,
  baseHeaders: Record<string, string>,
  version: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const url = server.url as string
  const headers = { ...baseHeaders }

  const init = await postJsonRpc(
    url,
    headers,
    {
      jsonrpc: '2.0',
      id: ID_LEGACY_INIT,
      method: 'initialize',
      params: { protocolVersion: version, capabilities: {}, clientInfo: CLIENT_INFO }
    },
    timeoutMs,
  )

  if (!init.response.ok) {
    return {
      server: server.name,
      ok: false,
      tools: [],
      characters: 0,
      error: `initialize returned HTTP ${String(init.response.status)}`
    }
  }

  const sessionId = init.response.headers.get('mcp-session-id')
  if (sessionId) headers['mcp-session-id'] = sessionId

  try {
    await postJsonRpc(url, headers, { jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs)
  } catch {
    // A server that does not accept the notification still answers tools/list.
  }

  const list = await postJsonRpc(
    url,
    headers,
    { jsonrpc: '2.0', id: ID_LEGACY_TOOLS, method: 'tools/list', params: {} },
    timeoutMs,
  )

  if (!list.response.ok) {
    return {
      server: server.name,
      ok: false,
      tools: [],
      characters: 0,
      error: `tools/list returned HTTP ${String(list.response.status)}`
    }
  }

  const message = parseRpcBody(list.text)
  if (!message || message.error || message.result === undefined) {
    return {
      server: server.name,
      ok: false,
      tools: [],
      characters: 0,
      error: message?.error?.message ?? 'tools/list returned no readable result'
    }
  }

  return {
    server: server.name,
    ok: true,
    tools: extractTools(message.result),
    characters: JSON.stringify(message.result ?? {}).length
  }
}

/**
 * Read a remote server's tool list, whichever era it implements.
 *
 * A modern request goes first. The specification makes the response tell the eras
 * apart: a recognized modern error means a modern server and the client retries with a
 * version it advertises, while a `400`, `404` or `405` carrying anything else is a
 * server that still expects the `initialize` handshake.
 */
async function probeHttpServer(server: ResolvedMcpServer, timeoutMs: number): Promise<ProbeResult> {
  if (!server.url) {
    return { server: server.name, ok: false, tools: [], characters: 0, error: 'no url' }
  }

  const url = server.url
  const baseHeaders = { ...(server.headers ?? {}) }

  try {
    let attempt = await requestModernToolsList(url, baseHeaders, PROTOCOL_VERSION, timeoutMs)
    let message = parseRpcBody(attempt.text)

    if (message?.error?.code === UNSUPPORTED_PROTOCOL_VERSION) {
      const choice = chooseVersion(supportedFromError(message.error))
      if (!choice) {
        return {
          server: server.name,
          ok: false,
          tools: [],
          characters: 0,
          error: message.error.message ?? 'server supports no protocol version this CLI speaks'
        }
      }
      if (choice.era === 'legacy') {
        return await probeLegacyHttpServer(server, baseHeaders, choice.version, timeoutMs)
      }
      attempt = await requestModernToolsList(url, baseHeaders, choice.version, timeoutMs)
      message = parseRpcBody(attempt.text)
    }

    if (attempt.response.ok && message && !message.error && message.result !== undefined) {
      const pending = inputRequiredError(message.result)
      if (pending) {
        return { server: server.name, ok: false, tools: [], characters: 0, error: pending }
      }
      return {
        server: server.name,
        ok: true,
        tools: extractTools(message.result),
        characters: JSON.stringify(message.result ?? {}).length
      }
    }

    // A reserved error code identifies a modern server, so falling back would only
    // produce a second, less useful failure.
    if (isModernError(message?.error)) {
      return {
        server: server.name,
        ok: false,
        tools: [],
        characters: 0,
        error: message?.error?.message ?? `tools/list returned HTTP ${String(attempt.response.status)}`
      }
    }

    return await probeLegacyHttpServer(server, baseHeaders, LEGACY_PROTOCOL_VERSION, timeoutMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      server: server.name,
      ok: false,
      tools: [],
      characters: 0,
      error: error instanceof Error && error.name === 'AbortError'
        ? `timed out after ${String(timeoutMs)}ms`
        : message
    }
  }
}

/**
 * Connect to an MCP server and read its tool list.
 *
 * Used by `agents mcp budget` to show what each server costs in context before
 * an agent ever starts. Servers that still carry `${VAR}` placeholders are
 * skipped rather than started with a broken value.
 */
export async function probeServerTools(server: ResolvedMcpServer, timeoutMs = 15000): Promise<ProbeResult> {
  const unresolved = [
    server.url,
    server.command,
    ...(server.args ?? []),
    ...Object.values(server.env ?? {}),
    ...Object.values(server.headers ?? {})
  ]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => /\$\{[A-Z0-9_]+\}/.test(value))

  if (unresolved) {
    return {
      server: server.name,
      ok: false,
      tools: [],
      characters: 0,
      skipped: 'unresolved ${VAR} placeholder'
    }
  }

  return server.transport === 'stdio'
    ? probeStdioServer(server, timeoutMs)
    : probeHttpServer(server, timeoutMs)
}
