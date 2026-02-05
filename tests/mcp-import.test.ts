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

  it('fails for unsupported payload shapes', () => {
    const payload = JSON.stringify({
      unsupported: true
    })

    expect(() => parseImportedServers(payload)).toThrow(/Unsupported import shape/)
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
