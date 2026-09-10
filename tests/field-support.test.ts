import { describe, expect, it } from 'vitest'
import { collectUnsupportedFieldWarnings } from '../src/core/fieldSupport.js'
import type { IntegrationName, ResolvedMcpServer } from '../src/types.js'

function byTarget(entries: Partial<Record<IntegrationName, ResolvedMcpServer[]>>): Record<IntegrationName, ResolvedMcpServer[]> {
  return entries as Record<IntegrationName, ResolvedMcpServer[]>
}

describe('unsupported field warnings', () => {
  it('names the field, the server and the integrations that ignore it', () => {
    const server: ResolvedMcpServer = {
      name: 'api',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headersHelper: '/opt/bin/auth.sh'
    }

    const warnings = collectUnsupportedFieldWarnings(
      byTarget({ claude: [server], cursor: [server], zed: [server] }),
      ['claude', 'cursor', 'zed'],
    )

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"api"')
    expect(warnings[0]).toContain('headersHelper')
    expect(warnings[0]).toContain('cursor, zed')
    expect(warnings[0]).not.toContain('claude,')
  })

  it('stays quiet for a field every enabled integration supports', () => {
    const server: ResolvedMcpServer = { name: 'docs', transport: 'stdio', command: 'server', timeout: 5000 }

    const warnings = collectUnsupportedFieldWarnings(byTarget({ droid: [server], kilo: [server] }), ['droid', 'kilo'])

    expect(warnings).toEqual([])
  })

  it('ignores remote-only fields on stdio servers', () => {
    const server: ResolvedMcpServer = {
      name: 'local',
      transport: 'stdio',
      command: 'server',
      bearerTokenEnvVar: 'TOKEN'
    }

    const warnings = collectUnsupportedFieldWarnings(byTarget({ cursor: [server] }), ['cursor'])

    expect(warnings).toEqual([])
  })

  it('says nothing about integrations that are not enabled', () => {
    const server: ResolvedMcpServer = { name: 'api', transport: 'http', url: 'https://x/mcp', oauth: { scopes: 'read' } }

    const warnings = collectUnsupportedFieldWarnings(byTarget({ zed: [server] }), [])

    expect(warnings).toEqual([])
  })
})
