import { describe, expect, it } from 'vitest'
import TOML from '@iarna/toml'
import {
  renderAntigravityMcp,
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
import {
  CODEX_MANAGED_MCP_BEGIN,
  CODEX_MANAGED_MCP_END,
  mergeCodexConfig
} from '../src/core/codexConfig.js'
import { buildHermesPayload } from '../src/integrations/hermes.js'
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

  it('replaces only the agents-sync managed Codex block', () => {
    const unmanaged = [
      '# Project comment',
      'model = "gpt-5.6-sol"',
      '',
      '[mcp_servers.node_repl]',
      'enabled = false',
      ''
    ].join('\n')
    const firstGenerated = renderCodexToml([{
      name: 'executor',
      transport: 'stdio',
      command: 'executor',
      args: ['mcp', '--scope', 'first']
    }]).content
    const secondGenerated = renderCodexToml([{
      name: 'executor',
      transport: 'stdio',
      command: 'executor',
      args: ['mcp', '--scope', 'second']
    }]).content

    const first = mergeCodexConfig(unmanaged, firstGenerated)
    const second = mergeCodexConfig(first, secondGenerated)
    const firstBegin = first.indexOf(CODEX_MANAGED_MCP_BEGIN)
    const firstEnd = first.indexOf('\n', first.indexOf(CODEX_MANAGED_MCP_END))

    expect(first.slice(0, firstBegin)).toBe(unmanaged)
    expect(first.slice(firstEnd + 1)).toBe('')
    expect(second.slice(0, second.indexOf(CODEX_MANAGED_MCP_BEGIN))).toBe(
      first.slice(0, first.indexOf(CODEX_MANAGED_MCP_BEGIN)),
    )
    expect(second).toContain('"second"')
    expect(second).not.toContain('"first"')
    expect(second.match(/# BEGIN agents-sync managed MCP/g)).toHaveLength(1)
    expect(() => TOML.parse(second)).not.toThrow()
  })

  it('preserves byte-exact unmanaged content before and after an existing managed block', () => {
    const before = '# Before block\nmodel = "gpt-5.6-sol"\n\n'
    const after = '\n# After block\n[features]\nweb_search = true\n'
    const existing = [
      before,
      CODEX_MANAGED_MCP_BEGIN,
      '\n[mcp_servers."executor"]\ncommand = "old"\n',
      CODEX_MANAGED_MCP_END,
      after
    ].join('')
    const generated = renderCodexToml([{
      name: 'executor',
      transport: 'stdio',
      command: 'executor',
      args: ['mcp']
    }]).content

    const merged = mergeCodexConfig(existing, generated)
    const begin = merged.indexOf(CODEX_MANAGED_MCP_BEGIN)
    const end = merged.indexOf(CODEX_MANAGED_MCP_END) + CODEX_MANAGED_MCP_END.length

    expect(merged.slice(0, begin)).toBe(before)
    expect(merged.slice(end)).toBe(after)
    expect(merged).toContain('command = "executor"')
    expect(merged).not.toContain('command = "old"')
  })

  it.each(['"""', "'''"])(
    'does not treat marker lines inside a %s TOML string as ownership markers',
    (delimiter) => {
    const unmanaged = [
      `prompt = ${delimiter}`,
      CODEX_MANAGED_MCP_BEGIN,
      'This text belongs to the prompt.',
      CODEX_MANAGED_MCP_END,
      delimiter,
      ''
    ].join('\n')

    const merged = mergeCodexConfig(unmanaged, renderCodexToml([]).content)

    expect(merged.slice(0, unmanaged.length)).toBe(unmanaged)
    expect(merged).toContain([
      `prompt = ${delimiter}`,
      CODEX_MANAGED_MCP_BEGIN,
      'This text belongs to the prompt.',
      CODEX_MANAGED_MCP_END,
      delimiter
    ].join('\n'))
    expect(merged.match(/# BEGIN agents-sync managed MCP/g)).toHaveLength(2)
    expect(() => TOML.parse(merged)).not.toThrow()
    },
  )

  it('does not treat marker-like longer comment lines as ownership markers', () => {
    const unmanaged = [
      `# Documentation mentions ${CODEX_MANAGED_MCP_BEGIN}`,
      `# Documentation mentions ${CODEX_MANAGED_MCP_END}`,
      `  ${CODEX_MANAGED_MCP_BEGIN}`,
      `  ${CODEX_MANAGED_MCP_END}`,
      'model = "gpt-5.6-sol"',
      ''
    ].join('\n')

    const merged = mergeCodexConfig(unmanaged, renderCodexToml([]).content)

    expect(merged.slice(0, unmanaged.length)).toBe(unmanaged)
    expect(merged).toContain(`# Documentation mentions ${CODEX_MANAGED_MCP_BEGIN}`)
    expect(merged).toContain(`# Documentation mentions ${CODEX_MANAGED_MCP_END}`)
    expect(merged).toContain(`  ${CODEX_MANAGED_MCP_BEGIN}`)
    expect(merged).toContain(`  ${CODEX_MANAGED_MCP_END}`)
    expect(() => TOML.parse(merged)).not.toThrow()
  })

  it('does not treat marker substrings in escaped basic string values as ownership markers', () => {
    const unmanaged = [
      `begin_note = "escaped quote: \\"; marker: ${CODEX_MANAGED_MCP_BEGIN}"`,
      `end_note = "marker: ${CODEX_MANAGED_MCP_END}"`,
      ''
    ].join('\n')

    const merged = mergeCodexConfig(unmanaged, renderCodexToml([]).content)

    expect(merged.slice(0, unmanaged.length)).toBe(unmanaged)
    expect(merged).toContain(`escaped quote: \\"; marker: ${CODEX_MANAGED_MCP_BEGIN}`)
    expect(() => TOML.parse(merged)).not.toThrow()
  })

  it('preserves CRLF outside a managed block and uses it for the replacement block', () => {
    const before = 'model = "gpt-5.6-sol"\r\n\r\n'
    const after = '\r\n# After\r\nweb_search = true\r\n'
    const existing = [
      before,
      CODEX_MANAGED_MCP_BEGIN,
      '\r\n[mcp_servers."executor"]\r\ncommand = "old"\r\n',
      CODEX_MANAGED_MCP_END,
      after
    ].join('')

    const merged = mergeCodexConfig(existing, renderCodexToml([{
      name: 'executor',
      transport: 'stdio',
      command: 'executor',
      args: ['mcp']
    }]).content)
    const begin = merged.indexOf(CODEX_MANAGED_MCP_BEGIN)
    const end = merged.indexOf(CODEX_MANAGED_MCP_END) + CODEX_MANAGED_MCP_END.length
    const managed = merged.slice(begin, end)

    expect(merged.slice(0, begin)).toBe(before)
    expect(merged.slice(end)).toBe(after)
    expect(managed).not.toMatch(/(?<!\r)\n/)
    expect(() => TOML.parse(merged)).not.toThrow()
  })

  it.each([
    `${CODEX_MANAGED_MCP_BEGIN}\n`,
    `${CODEX_MANAGED_MCP_END}\n`,
    `${CODEX_MANAGED_MCP_BEGIN}\n${CODEX_MANAGED_MCP_BEGIN}\n${CODEX_MANAGED_MCP_END}\n`,
    `${CODEX_MANAGED_MCP_BEGIN}\n${CODEX_MANAGED_MCP_END}\n${CODEX_MANAGED_MCP_END}\n`
  ])('rejects a malformed agents-sync managed Codex block', (existing) => {
    expect(() => mergeCodexConfig(existing, renderCodexToml([]).content)).toThrow(
      /malformed agents-sync managed MCP block/,
    )
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

  it('renders antigravity mcp_config map', () => {
    const rendered = renderAntigravityMcp(servers)
    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
      },
      'http-tools': {
        serverUrl: 'https://example.com/mcp'
      },
      'sse-tools': {
        serverUrl: 'https://example.com/sse'
      }
    })
    expect(rendered.mcpServers['filesystem']).not.toHaveProperty('type')
    expect(rendered.mcpServers['http-tools']).not.toHaveProperty('url')
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

  it('renders Hermes-native stdio, HTTP and SSE definitions', () => {
    const rendered = buildHermesPayload(servers)

    expect(rendered.mcpServers).toMatchObject({
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
        enabled: true
      },
      'http-tools': {
        url: 'https://example.com/mcp',
        headers: {
          Authorization: 'Bearer token'
        },
        enabled: true
      },
      'sse-tools': {
        url: 'https://example.com/sse',
        transport: 'sse',
        enabled: true
      }
    })
    expect(rendered.warnings).toEqual([])
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

    it('warns when Hermes cannot represent a stdio cwd', () => {
      const rendered = buildHermesPayload(serversWithCwd)

      expect(rendered.mcpServers['project-server']).not.toHaveProperty('cwd')
      expect(rendered.warnings.join(' ')).toContain('does not support cwd')
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

    it('antigravity includes cwd for stdio server', () => {
      const rendered = renderAntigravityMcp(serversWithCwd)
      expect(rendered.mcpServers['project-server']).toMatchObject({
        command: 'pnpx',
        cwd: '/abs/path/to/project'
      })
      expect(rendered.mcpServers['project-server']).not.toHaveProperty('type')
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

      const antigravity = renderAntigravityMcp(servers)
      expect(antigravity.mcpServers['filesystem']).not.toHaveProperty('cwd')

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
    it('skips stdio server missing command in renderCopilotCliMcp', () => {
      const serversWithMissingCommand: ResolvedMcpServer[] = [
        {
          name: 'filesystem',
          transport: 'stdio',
          args: ['server']
        } as ResolvedMcpServer
      ]

      const rendered = renderCopilotCliMcp(serversWithMissingCommand)
      expect(rendered.mcpServers.filesystem).toBeUndefined()
      expect(rendered.warnings).toContain('Server "filesystem" has no command; skipped in Copilot CLI MCP output.')
    })

    it('skips remote server missing url in renderCopilotCliMcp', () => {
      const remoteServers: ResolvedMcpServer[] = [
        {
          name: 'http-tools',
          transport: 'http',
          headers: {
            Authorization: 'Bearer token'
          }
        } as ResolvedMcpServer,
        {
          name: 'sse-tools',
          transport: 'sse'
        } as ResolvedMcpServer
      ]

      const rendered = renderCopilotCliMcp(remoteServers)
      expect(rendered.mcpServers['http-tools']).toBeUndefined()
      expect(rendered.mcpServers['sse-tools']).toBeUndefined()
      expect(rendered.warnings).toContain('Server "http-tools" has no url; skipped in Copilot CLI MCP output.')
      expect(rendered.warnings).toContain('Server "sse-tools" has no url; skipped in Copilot CLI MCP output.')
    })

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
