import { createServer, type IncomingMessage, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { probeServerTools } from '../src/core/mcpProbe.js'

const tempDirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0, servers.length)) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

const TOOLS = [{ name: 'search', description: 'Search things', inputSchema: { type: 'object' } }]

/** Write an executable stdio MCP server that answers from the given handler source. */
async function writeStdioServer(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-probe-server-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'server.mjs')
  await writeFile(
    file,
    `#!/usr/bin/env node
let buffer = ''
const send = (message) => { process.stdout.write(JSON.stringify(message) + '\\n') }
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let index = buffer.indexOf('\\n')
  while (index !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    index = buffer.indexOf('\\n')
    if (!line) continue
    const message = JSON.parse(line)
    ${body}
  }
})
`,
    'utf8',
  )
  await chmod(file, 0o755)
  return file
}

async function listenOn(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  return `http://127.0.0.1:${String(address.port)}/mcp`
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

describe('stdio probe across protocol eras', () => {
  it('uses the stateless flow with a server that answers server/discover', async () => {
    const command = await writeStdioServer(`
      if (message.method === 'server/discover') {
        send({ jsonrpc: '2.0', id: message.id, result: {
          resultType: 'complete',
          supportedVersions: ['2026-07-28'],
          capabilities: { tools: {} }
        } })
        continue
      }
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no handshake here' } })
        continue
      }
      if (message.method === 'tools/list') {
        const version = message.params?._meta?.['io.modelcontextprotocol/protocolVersion']
        if (version !== '2026-07-28') {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'missing protocol version: ' + version } })
          continue
        }
        send({ jsonrpc: '2.0', id: message.id, result: {
          resultType: 'complete',
          tools: ${JSON.stringify(TOOLS)},
          ttlMs: 3600000,
          cacheScope: 'public'
        } })
      }
    `)

    const result = await probeServerTools({ name: 'modern', transport: 'stdio', command: 'node', args: [command] }, 8000)

    expect(result.ok).toBe(true)
    expect(result.tools.map((tool) => tool.name)).toEqual(['search'])
  })

  it('falls back to the handshake when server/discover is an unknown method', async () => {
    const command = await writeStdioServer(`
      if (message.method === 'server/discover') {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
        continue
      }
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })
        continue
      }
      if (message.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: message.id, result: { tools: ${JSON.stringify(TOOLS)} } })
      }
    `)

    const result = await probeServerTools({ name: 'legacy', transport: 'stdio', command: 'node', args: [command] }, 8000)

    expect(result.ok).toBe(true)
    expect(result.tools.map((tool) => tool.name)).toEqual(['search'])
  })

  it('falls back when the server ignores server/discover entirely', async () => {
    const command = await writeStdioServer(`
      if (message.method === 'server/discover') continue
      if (message.method === 'initialize') {
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })
        continue
      }
      if (message.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: message.id, result: { tools: ${JSON.stringify(TOOLS)} } })
      }
    `)

    const result = await probeServerTools({ name: 'silent', transport: 'stdio', command: 'node', args: [command] }, 9000)

    expect(result.ok).toBe(true)
    expect(result.tools).toHaveLength(1)
  })

  it('retries on the legacy revision a modern server says it supports', async () => {
    const command = await writeStdioServer(`
      if (message.method === 'server/discover') {
        send({ jsonrpc: '2.0', id: message.id, error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: ['2025-06-18'], requested: '2026-07-28' }
        } })
        continue
      }
      if (message.method === 'initialize') {
        if (message.params?.protocolVersion !== '2025-06-18') {
          send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'wrong version' } })
          continue
        }
        send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })
        continue
      }
      if (message.method === 'tools/list') {
        send({ jsonrpc: '2.0', id: message.id, result: { tools: ${JSON.stringify(TOOLS)} } })
      }
    `)

    const result = await probeServerTools({ name: 'mismatch', transport: 'stdio', command: 'node', args: [command] }, 8000)

    expect(result.ok).toBe(true)
    expect(result.tools).toHaveLength(1)
  })

  it('reports a server whose versions this client cannot speak', async () => {
    const command = await writeStdioServer(`
      if (message.method === 'server/discover') {
        send({ jsonrpc: '2.0', id: message.id, error: {
          code: -32022,
          message: 'Unsupported protocol version',
          data: { supported: [], requested: '2026-07-28' }
        } })
      }
    `)

    const result = await probeServerTools({ name: 'alien', transport: 'stdio', command: 'node', args: [command] }, 8000)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unsupported protocol version')
  })
})

describe('http probe across protocol eras', () => {
  it('sends the required headers and reads the stateless result', async () => {
    const seen: Record<string, string | undefined> = {}
    const url = await listenOn(async (request, response) => {
      const body = await readBody(request)
      seen['mcp-protocol-version'] = request.headers['mcp-protocol-version'] as string | undefined
      seen['mcp-method'] = request.headers['mcp-method'] as string | undefined
      seen.meta = JSON.stringify(
        ((body.params as Record<string, unknown> | undefined)?._meta ?? {}) as Record<string, unknown>,
      )
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: { resultType: 'complete', tools: TOOLS, ttlMs: 60000, cacheScope: 'public' }
      }))
    })

    const result = await probeServerTools({ name: 'modern-http', transport: 'http', url }, 8000)

    expect(result.ok).toBe(true)
    expect(seen['mcp-protocol-version']).toBe('2026-07-28')
    expect(seen['mcp-method']).toBe('tools/list')
    expect(seen.meta).toContain('io.modelcontextprotocol/protocolVersion')
  })

  it('falls back to the handshake on a 400 that is not a modern error', async () => {
    const url = await listenOn(async (request, response) => {
      const body = await readBody(request)
      const method = body.method as string | undefined

      if (method === 'tools/list' && request.headers['mcp-protocol-version'] === '2026-07-28') {
        response.writeHead(400, { 'content-type': 'text/plain' })
        response.end('Bad Request')
        return
      }
      if (method === 'initialize') {
        response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'abc' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }))
        return
      }
      if (method === 'tools/list') {
        if (request.headers['mcp-session-id'] !== 'abc') {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'no session' } }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: TOOLS } }))
        return
      }
      response.writeHead(202)
      response.end()
    })

    const result = await probeServerTools({ name: 'legacy-http', transport: 'http', url }, 8000)

    expect(result.ok).toBe(true)
    expect(result.tools.map((tool) => tool.name)).toEqual(['search'])
  })

  it('uses the revision a server advertises instead of the one it rejected', async () => {
    const versionsSeen: string[] = []
    let initializeVersion: unknown
    const url = await listenOn(async (request, response) => {
      const body = await readBody(request)
      const version = request.headers['mcp-protocol-version'] as string | undefined
      if (version) versionsSeen.push(version)

      if (body.method === 'tools/list' && version === '2026-07-28') {
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-11-25'] } }
        }))
        return
      }
      if (body.method === 'initialize') {
        initializeVersion = (body.params as Record<string, unknown> | undefined)?.protocolVersion
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25' } }))
        return
      }
      if (body.method === 'tools/list') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: TOOLS } }))
        return
      }
      response.writeHead(202)
      response.end()
    })

    const result = await probeServerTools({ name: 'negotiating', transport: 'http', url }, 8000)

    // The version the server named is the one the handshake uses, and the modern
    // attempt is not repeated with a version the server already rejected.
    expect(versionsSeen[0]).toBe('2026-07-28')
    expect(initializeVersion).toBe('2025-11-25')
    expect(result.ok).toBe(true)
  })
})
