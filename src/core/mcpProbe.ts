import { spawn } from 'node:child_process'
import { CLI_VERSION } from './version.js'
import type { ResolvedMcpServer } from '../types.js'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'agents-cli', version: CLI_VERSION }

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

interface JsonRpcResponse {
  id?: number | string
  method?: string
  result?: unknown
  error?: { message?: string }
}

function toolCharacters(tool: unknown): number {
  return JSON.stringify(tool ?? {}).length
}

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

        if (message.id === 1) {
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
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
          continue
        }

        if (message.id === 2) {
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
          const tools = extractTools(message.result)
          finish({
            server: server.name,
            ok: true,
            tools,
            characters: JSON.stringify(message.result ?? {}).length
          })
          return
        }
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO
      }
    })
  })
}

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

/** Pull the JSON-RPC payload out of a plain JSON body or an SSE stream. */
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

  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      return JSON.parse(payload) as JsonRpcResponse
    } catch {
      continue
    }
  }
  return undefined
}

async function probeHttpServer(server: ResolvedMcpServer, timeoutMs: number): Promise<ProbeResult> {
  if (!server.url) {
    return { server: server.name, ok: false, tools: [], characters: 0, error: 'no url' }
  }

  const headers = { ...(server.headers ?? {}) }

  try {
    const init = await postJsonRpc(
      server.url,
      headers,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }
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

    // The specification requires this notification before any other request; servers
    // that track sessions reject tools/list without it.
    try {
      await postJsonRpc(server.url, headers, { jsonrpc: '2.0', method: 'notifications/initialized' }, timeoutMs)
    } catch {
      // A server that does not accept the notification still answers tools/list.
    }

    const list = await postJsonRpc(
      server.url,
      headers,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
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
