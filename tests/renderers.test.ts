import { describe, expect, it } from 'vitest'
import TOML from '@iarna/toml'
import {
  renderClaudeDesktopMcp,
  renderCodexToml,
  renderCopilotCliMcp,
  renderGeminiServers,
  renderJunieMcp,
  renderOpencodeMcp,
  renderVscodeMcp,
  renderWindsurfMcp
} from '../src/core/renderers.js'
import { toManagedClaudeDesktopName } from '../src/core/claudeDesktop.js'
import type { ResolvedMcpServer } from '../src/types.js'

const projectRoot = '/tmp/agents-renderers'

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
        httpUrl: 'https://example.com/mcp'
      },
      'sse-tools': {
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

  it('renders copilot cli mcp map', () => {
    const rendered = renderCopilotCliMcp(servers)
    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        type: 'stdio',
        command: 'npx',
        tools: ['*']
      },
      'http-tools': {
        type: 'http',
        url: 'https://example.com/mcp',
        tools: ['*']
      },
      'sse-tools': {
        type: 'sse',
        url: 'https://example.com/sse',
        tools: ['*']
      }
    })
  })

  it('renders claude desktop mcp payload', () => {
    const rendered = renderClaudeDesktopMcp(servers, projectRoot)
    expect(rendered.mcpServers).toMatchObject({
      [toManagedClaudeDesktopName(projectRoot, 'filesystem')]: {
        type: 'stdio',
        command: 'npx'
      }
    })
    expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'http-tools')]).toBeUndefined()
    expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'sse-tools')]).toBeUndefined()
    expect(rendered.warnings.join(' ')).toContain('custom connectors')
  })

  it('renders windsurf mcp payload', () => {
    const rendered = renderWindsurfMcp(servers)
    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        command: 'npx'
      },
      'http-tools': {
        serverUrl: 'https://example.com/mcp'
      },
      'sse-tools': {
        serverUrl: 'https://example.com/sse'
      }
    })
  })

  it('renders opencode mcp payload', () => {
    const rendered = renderOpencodeMcp(servers)
    expect(rendered.mcp).toMatchObject({
      filesystem: {
        type: 'local',
        enabled: true,
        command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
      },
      'http-tools': {
        type: 'remote',
        enabled: true,
        url: 'https://example.com/mcp'
      },
      'sse-tools': {
        type: 'remote',
        enabled: true,
        url: 'https://example.com/sse'
      }
    })
  })

  it('renders junie mcp payload', () => {
    const rendered = renderJunieMcp(servers)
    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        command: 'npx'
      },
      'http-tools': {
        url: 'https://example.com/mcp'
      },
      'sse-tools': {
        url: 'https://example.com/sse'
      }
    })
    expect(rendered.mcpServers['filesystem']).not.toHaveProperty('type')
  })

  describe('cwd propagation', () => {
    const serversWithCwd: ResolvedMcpServer[] = [
      {
        name: 'project-server',
        transport: 'stdio',
        command: 'pnpx',
        args: ['xcodebuildmcp@latest', 'mcp'],
        cwd: '/abs/path/to/project'
      }
    ]

    it('codex toml includes cwd for stdio server', () => {
      const rendered = renderCodexToml(serversWithCwd)
      expect(rendered.content).toContain('cwd = "/abs/path/to/project"')
      expect(() => TOML.parse(rendered.content)).not.toThrow()
    })

    it('gemini includes cwd for stdio server', () => {
      const rendered = renderGeminiServers(serversWithCwd)
      expect(rendered.mcpServers['project-server']).toMatchObject({
        type: 'stdio',
        command: 'pnpx',
        cwd: '/abs/path/to/project'
      })
    })

    it('vscode includes cwd for stdio server', () => {
      const rendered = renderVscodeMcp(serversWithCwd)
      expect(rendered.servers['project-server']).toMatchObject({
        type: 'stdio',
        command: 'pnpx',
        cwd: '/abs/path/to/project'
      })
    })

    it('claude desktop omits cwd and warns to prefer absolute paths', () => {
      const rendered = renderClaudeDesktopMcp(serversWithCwd, projectRoot)
      expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'project-server')]).toMatchObject({
        type: 'stdio',
        command: 'pnpx'
      })
      expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'project-server')]).not.toHaveProperty('cwd')
      expect(rendered.warnings.join(' ')).toContain('does not document cwd support')
    })

    it('windsurf includes cwd for stdio server', () => {
      const rendered = renderWindsurfMcp(serversWithCwd)
      expect(rendered.mcpServers['project-server']).toMatchObject({
        command: 'pnpx',
        cwd: '/abs/path/to/project'
      })
    })

    it('opencode includes cwd for stdio server', () => {
      const rendered = renderOpencodeMcp(serversWithCwd)
      expect(rendered.mcp['project-server']).toMatchObject({
        type: 'local',
        command: ['pnpx', 'xcodebuildmcp@latest', 'mcp'],
        cwd: '/abs/path/to/project'
      })
    })

    it('junie includes cwd for stdio server', () => {
      const rendered = renderJunieMcp(serversWithCwd)
      expect(rendered.mcpServers['project-server']).toMatchObject({
        command: 'pnpx',
        cwd: '/abs/path/to/project'
      })
    })

    it('omits cwd when not set', () => {
      const codex = renderCodexToml(servers)
      expect(codex.content).not.toMatch(/^\s*cwd\s*=/m)

      const gemini = renderGeminiServers(servers)
      expect(gemini.mcpServers['filesystem']).not.toHaveProperty('cwd')

      const vscode = renderVscodeMcp(servers)
      expect(vscode.servers['filesystem']).not.toHaveProperty('cwd')

      const claudeDesktop = renderClaudeDesktopMcp(servers, projectRoot)
      expect(claudeDesktop.mcpServers[toManagedClaudeDesktopName(projectRoot, 'filesystem')]).not.toHaveProperty('cwd')

      const windsurf = renderWindsurfMcp(servers)
      expect(windsurf.mcpServers['filesystem']).not.toHaveProperty('cwd')

      const opencode = renderOpencodeMcp(servers)
      expect(opencode.mcp['filesystem']).not.toHaveProperty('cwd')

      const junie = renderJunieMcp(servers)
      expect(junie.mcpServers['filesystem']).not.toHaveProperty('cwd')
    })
  })

  describe('skip and warn for missing required fields', () => {
    it('skips stdio server missing command in renderClaudeDesktopMcp', () => {
      const serversWithMissingCommand: ResolvedMcpServer[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
        } as ResolvedMcpServer
      ]

      const rendered = renderClaudeDesktopMcp(serversWithMissingCommand, projectRoot)
      expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'filesystem')]).toBeUndefined()
      expect(rendered.warnings).toContain('Server "filesystem" has no command; skipped in Claude Desktop output.')
    })

    it('skips http server in renderClaudeDesktopMcp', () => {
      const remoteServers: ResolvedMcpServer[] = [
        {
          name: 'http-tools',
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: {
            Authorization: 'Bearer token'
          }
        } as ResolvedMcpServer
      ]

      const rendered = renderClaudeDesktopMcp(remoteServers, projectRoot)
      expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'http-tools')]).toBeUndefined()
      expect(rendered.warnings.join(' ')).toContain('custom connectors')
    })

    it('skips sse server in renderClaudeDesktopMcp', () => {
      const remoteServers: ResolvedMcpServer[] = [
        {
          name: 'sse-tools',
          transport: 'sse',
          url: 'https://example.com/sse'
        } as ResolvedMcpServer
      ]

      const rendered = renderClaudeDesktopMcp(remoteServers, projectRoot)
      expect(rendered.mcpServers[toManagedClaudeDesktopName(projectRoot, 'sse-tools')]).toBeUndefined()
      expect(rendered.warnings.join(' ')).toContain('custom connectors')
    })
  })
})
