import { describe, expect, it } from 'vitest'
import TOML from '@iarna/toml'
import { renderCodexToml, renderGeminiServers, renderVscodeMcp } from '../src/core/renderers.js'
import type { ResolvedMcpServer } from '../src/types.js'

const servers: ResolvedMcpServer[] = [
  {
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
  },
  {
    name: 'http-tools',
    transport: 'http',
    url: 'https://example.com/mcp',
    headers: {
      Authorization: 'Bearer token'
    }
  },
  {
    name: 'sse-tools',
    transport: 'sse',
    url: 'https://example.com/sse'
  }
]

describe('renderers', () => {
  it('renders codex toml for stdio/http/sse and stays valid TOML', () => {
    const rendered = renderCodexToml(servers)
    expect(rendered.content).toContain('[mcp_servers."filesystem"]')
    expect(rendered.content).toContain('[mcp_servers."http-tools"]')
    expect(rendered.content).toContain('url = "https://example.com/mcp"')
    expect(rendered.content).toContain('[mcp_servers."http-tools".http_headers]')
    expect(rendered.content).toContain('"Authorization" = "Bearer token"')
    expect(rendered.content).toContain('[mcp_servers."sse-tools"]')
    expect(rendered.warnings.join(' ')).toContain('legacy sse transport')
    expect(() => TOML.parse(rendered.content)).not.toThrow()
  })

  it('renders gemini server map for stdio and http', () => {
    const rendered = renderGeminiServers(servers)
    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        type: 'stdio',
        command: 'npx'
      },
      'http-tools': {
        type: 'http',
        url: 'https://example.com/mcp'
      },
      'sse-tools': {
        type: 'sse',
        url: 'https://example.com/sse'
      }
    })
  })

  it('renders vscode mcp map', () => {
    const rendered = renderVscodeMcp(servers)
    expect(rendered.servers).toMatchObject({
      filesystem: {
        type: 'stdio',
        command: 'npx'
      },
      'http-tools': {
        type: 'http',
        url: 'https://example.com/mcp'
      },
      'sse-tools': {
        type: 'sse',
        url: 'https://example.com/sse'
      }
    })
  })
})
