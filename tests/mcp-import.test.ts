import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractImportPayloadFromHtml,
  extractImportPayloadFromMarkdown,
  parseImportedServers,
  readImportInput
} from '../src/core/mcpImport.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('parseImportedServers', () => {
  it('retains all schema 4 connection, auth and tool restriction fields', () => {
    const server = {
      transport: 'http', url: 'https://example.com/mcp', timeout: 0, connectTimeout: 500,
      tools: [], disabledTools: ['write'], oauth: { clientId: 'client', scopes: 'read', clientSecret: '${CLIENT_SECRET}', authServerMetadataUrl: 'https://example.com/auth' },
      headersHelper: '${PROJECT_ROOT}/headers', bearerTokenEnvVar: 'API_TOKEN', envFile: '${PROJECT_ROOT}/.env'
    }
    expect(parseImportedServers(JSON.stringify({ mcp: { servers: { docs: server } } }))[0].server).toEqual(server)
  })

  it.each([
    { timeout: -1 }, { connectTimeout: '500' }, { tools: ['read', 5] },
    { disabledTools: 'write' }, { oauth: false }, { oauth: { clientId: 5 } },
    { headersHelper: 5 }, { bearerTokenEnvVar: 'BAD KEY' }, { envFile: 5 }
  ])('rejects invalid schema 4 field values: %j', fields => {
    expect(() => parseImportedServers(JSON.stringify({ docs: { url: 'https://example.com/mcp', ...fields } }))).toThrow()
  })

  it('parses { mcp: { servers } } shape', () => {
    const payload = JSON.stringify({
      mcp: {
        servers: {
          context7: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp']
          }
        }
      }
    })

    const out = parseImportedServers(payload)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('context7')
    expect(out[0]?.server.transport).toBe('stdio')
    expect(out[0]?.server.command).toBe('npx')
  })

  it('parses { mcpServers } shape and infers http transport', () => {
    const payload = JSON.stringify({
      mcpServers: {
        docs: {
          url: 'https://example.com/mcp'
        }
      }
    })

    const out = parseImportedServers(payload)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('docs')
    expect(out[0]?.server.transport).toBe('http')
    expect(out[0]?.server.url).toBe('https://example.com/mcp')
  })

  it('parses current httpUrl and streamable-http aliases', () => {
    const payload = JSON.stringify({
      mcpServers: {
        docs: {
          type: 'streamable-http',
          httpUrl: 'https://example.com/mcp'
        },
        search: {
          serverUrl: 'https://example.com/search-mcp'
        }
      }
    })

    const out = parseImportedServers(payload)
    expect(out).toHaveLength(2)
    expect(out.find((entry) => entry.name === 'docs')?.server).toMatchObject({
      transport: 'http',
      url: 'https://example.com/mcp'
    })
    expect(out.find((entry) => entry.name === 'search')?.server).toMatchObject({
      transport: 'http',
      url: 'https://example.com/search-mcp'
    })
  })

  it('parses single server object with explicit name override', () => {
    const payload = JSON.stringify({
      command: 'uvx',
      args: ['mcp-server-fetch']
    })

    const out = parseImportedServers(payload, 'fetch')
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('fetch')
    expect(out[0]?.server.transport).toBe('stdio')
    expect(out[0]?.server.command).toBe('uvx')
  })

  it('parses plain name->server map shape', () => {
    const payload = JSON.stringify({
      appcontext: {
        url: 'http://localhost:7777/sse',
        type: 'sse'
      }
    })

    const out = parseImportedServers(payload)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('appcontext')
    expect(out[0]?.server.transport).toBe('sse')
    expect(out[0]?.server.url).toBe('http://localhost:7777/sse')
  })

  it('fails for unsupported payload shapes', () => {
    const payload = JSON.stringify({
      unsupported: true
    })

    expect(() => parseImportedServers(payload)).toThrow(/Unsupported import shape/)
  })

  it('fails for invalid env keys in imported payload', () => {
    const payload = JSON.stringify({
      mcpServers: {
        docs: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp'],
          env: {
            'BAD KEY': '123'
          }
        }
      }
    })

    expect(() => parseImportedServers(payload)).toThrow(/Invalid environment variable key/)
  })

  it('fails for invalid header keys in imported payload', () => {
    const payload = JSON.stringify({
      mcpServers: {
        docs: {
          url: 'https://example.com/mcp',
          headers: {
            'Bad Header': 'x'
          }
        }
      }
    })

    expect(() => parseImportedServers(payload)).toThrow(/Invalid header key/)
  })

  it('extracts JSON from HTML code block payloads', () => {
    const html = `
      <html>
        <body>
          <pre><code class="language-json">{&quot;mcpServers&quot;:{&quot;context7&quot;:{&quot;command&quot;:[&quot;npx&quot;,&quot;-y&quot;,&quot;@upstash/context7-mcp&quot;]}}}</code></pre>
        </body>
      </html>
    `

    const extracted = extractImportPayloadFromHtml(html)
    expect(extracted).toBeTruthy()
    const parsed = parseImportedServers(extracted as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('context7')
    expect(parsed[0]?.server.transport).toBe('stdio')
  })

  it('extracts JSON from generic <pre><code> blocks without language class', () => {
    const html = `
      <html>
        <body>
          <pre><code>{
            &quot;appcontext&quot;: {
              &quot;url&quot;: &quot;http://localhost:7777/sse&quot;,
              &quot;type&quot;: &quot;sse&quot;
            }
          }</code></pre>
        </body>
      </html>
    `

    const extracted = extractImportPayloadFromHtml(html)
    expect(extracted).toBeTruthy()
    const parsed = parseImportedServers(extracted as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('appcontext')
    expect(parsed[0]?.server.transport).toBe('sse')
  })

  it('extracts JSON from markdown code block payloads', () => {
    const markdown = `
      Example:

      \`\`\`json
      {
        "mcpServers": {
          "XcodeBuildMCP": {
            "command": "npx",
            "args": ["-y", "xcodebuildmcp@beta", "mcp"]
          }
        }
      }
      \`\`\`
    `

    const extracted = extractImportPayloadFromMarkdown(markdown)
    expect(extracted).toBeTruthy()
    const parsed = parseImportedServers(extracted as string)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.name).toBe('XcodeBuildMCP')
    expect(parsed[0]?.server.transport).toBe('stdio')
  })

  it('reads import payload from URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            mcpServers: {
              docs: {
                url: 'https://example.com/mcp'
              }
            }
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          },
        ),
      ),
    )

    const raw = await readImportInput({
      url: 'https://mcpservers.org/servers/upstash/context7-mcp'
    })
    const parsed = parseImportedServers(raw)
    expect(parsed[0]?.name).toBe('docs')
    expect(parsed[0]?.server.transport).toBe('http')
  })

  it('retries transient fetch errors when reading import payload from URL', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('fetch failed')
    })

    fetchMock.mockImplementationOnce(async () => {
      throw new Error('fetch failed')
    })
    fetchMock.mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          mcpServers: {
            docs: {
              url: 'https://example.com/mcp'
            }
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const raw = await readImportInput({
      url: 'https://mcpservers.org/servers/upstash/context7-mcp'
    })
    const parsed = parseImportedServers(raw)
    expect(parsed[0]?.name).toBe('docs')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to GitHub README extraction for mcpservers pages without JSON snippet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('mcpservers.org/servers/cameroncooke/xcodebuildmcp')) {
          return new Response(
            '<html><body><a href="https://github.com/cameroncooke/xcodebuildmcp">repo</a></body></html>',
            {
              status: 200,
              headers: {
                'content-type': 'text/html'
              }
            },
          )
        }
        if (url.includes('api.github.com/repos/cameroncooke/xcodebuildmcp/readme')) {
          return new Response(
            [
              '```json',
              '{',
              '  "mcpServers": {',
              '    "XcodeBuildMCP": {',
              '      "command": "npx",',
              '      "args": ["-y", "xcodebuildmcp@beta", "mcp"]',
              '    }',
              '  }',
              '}',
              '```'
            ].join('\n'),
            {
              status: 200,
              headers: {
                'content-type': 'text/plain'
              }
            },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const raw = await readImportInput({
      url: 'https://mcpservers.org/servers/cameroncooke/xcodebuildmcp'
    })
    const parsed = parseImportedServers(raw)
    expect(parsed[0]?.name).toBe('XcodeBuildMCP')
    expect(parsed[0]?.server.command).toBe('npx')
  })

  it('rejects URL passed to --file with a helpful message', async () => {
    await expect(
      readImportInput({
        filePath: 'https://mcpservers.org/servers/cameroncooke/xcodebuildmcp'
      }),
    ).rejects.toThrow(/Option --file expects a local file path/)
  })
})

describe('parseImportedServers with OpenCode configs', () => {
  it('imports V2 servers with their OpenCode options and OAuth', () => {
    const [entry] = parseImportedServers(JSON.stringify({ mcp: { servers: {
      browser: {
        type: 'remote',
        url: 'https://example.com/mcp',
        disabled: true,
        protocol: 'auto',
        timeout: { startup: 1000, execution: 2000 },
        oauth: { client_id: 'client', client_secret: 'secret', scope: 'tools', auth_server_metadata_url: 'https://auth.example.com' }
      }
    } } }))
    expect(entry.server).toEqual({
      transport: 'http',
      url: 'https://example.com/mcp',
      opencode: { disabled: true, protocol: 'auto', timeout: { startup: 1000, execution: 2000 } },
      oauth: { clientId: 'client', clientSecret: 'secret', scopes: 'tools', authServerMetadataUrl: 'https://auth.example.com' }
    })
  })

  it('reads a legacy entry: enabled false stays an OpenCode setting, timeout is shared', () => {
    const [entry] = parseImportedServers(JSON.stringify({ docs: {
      type: 'local', command: ['node', 'docs.js'], environment: { KEY: 'v' }, enabled: false, timeout: 4000
    } }))
    expect(entry.server).toEqual({
      transport: 'stdio',
      command: 'node',
      args: ['docs.js'],
      env: { KEY: 'v' },
      timeout: 4000,
      opencode: { disabled: true }
    })
  })

  it('rejects OAuth settings the shared model cannot keep', () => {
    expect(() => parseImportedServers(JSON.stringify({ docs: {
      type: 'remote', url: 'https://example.com/mcp', oauth: { callback_port: 9000 }
    } }))).toThrow(/Unsupported OpenCode OAuth field "docs.oauth.callback_port"/)
  })

  it('rejects OpenCode options set both directly and under "opencode"', () => {
    expect(() => parseImportedServers(JSON.stringify({ docs: {
      type: 'local', command: ['node'], pool: true, opencode: { pool: false }
    } }))).toThrow(/both directly and under "opencode"/)
  })

  it('still rejects an object timeout outside OpenCode entries', () => {
    expect(() => parseImportedServers(JSON.stringify({ docs: { command: 'node', timeout: { execution: 1 } } })))
      .toThrow(/nonnegative finite number/)
  })
})
