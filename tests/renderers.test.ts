import { describe, expect, it } from 'vitest'
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
    url: 'https://example.com/mcp'
  }
]

describe('renderers', () => {
  it('renders codex toml and skips unsupported transports', () => {
    const rendered = renderCodexToml(servers)
    expect(rendered.content).toContain('[mcp_servers."filesystem"]')
    expect(rendered.content).not.toContain('http-tools')
    expect(rendered.warnings.join(' ')).toContain('non-stdio')
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
      }
    })
  })
})
