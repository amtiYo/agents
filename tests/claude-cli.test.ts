import { describe, expect, it } from 'vitest'
import { parseClaudeManagedServerNames } from '../src/core/claudeCli.js'

describe('claude cli parser', () => {
  it('extracts unique managed server names from claude mcp list output', () => {
    const output = `
Checking MCP server health...

plugin:context7:context7: npx -y @upstash/context7-mcp - ✓ Connected
agents__fetch: uvx mcp-server-fetch - ✓ Connected
agents__filesystem: npx -y @modelcontextprotocol/server-filesystem /repo - ✓ Connected
agents__fetch: uvx mcp-server-fetch - ✓ Connected
agents__my-repo: node /absolute/path/to/generated/server.mjs - ✗ Failed to connect
`

    expect(parseClaudeManagedServerNames(output)).toEqual([
      'agents__fetch',
      'agents__filesystem',
      'agents__my-repo'
    ])
  })

  it('ignores non-managed names', () => {
    const output = `
plugin:playwright:playwright: npx @playwright/mcp@latest - ✓ Connected
context7: https://mcp.context7.com/mcp (HTTP) - ✓ Connected
`
    expect(parseClaudeManagedServerNames(output)).toEqual([])
  })
})

