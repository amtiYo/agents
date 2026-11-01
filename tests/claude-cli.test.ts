import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseClaudeManagedServerNames, readClaudeScopeServerNames } from '../src/core/claudeCli.js'

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


describe('claude config reader', () => {
  const dirs: string[] = []
  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function setup(content: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-config-'))
    dirs.push(dir)
    const project = path.join(dir, 'project')
    await mkdir(project)
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(dir, 'config'))
    await mkdir(path.join(dir, 'config'))
    await writeFile(path.join(dir, 'config', '.claude.json'), content.replaceAll('PROJECT', await realpath(project)))
    return { dir, project }
  }

  it('reads user and local registrations with the given prefix', async () => {
    const { dir, project } = await setup(JSON.stringify({
      mcpServers: { agents__abc__docs: {}, agents__other__docs: {}, manual: {} },
      projects: { PROJECT: { mcpServers: { agents__fetch: {}, manual: {} } } }
    }))
    expect(await readClaudeScopeServerNames(project, 'user', 'agents__abc__')).toEqual(['agents__abc__docs'])
    expect(await readClaudeScopeServerNames(project, 'local', 'agents__')).toEqual(['agents__fetch'])
    // Claude keys a project by its resolved path, so a symlinked root finds the same entry.
    await symlink(project, path.join(dir, 'link'))
    expect(await readClaudeScopeServerNames(path.join(dir, 'link'), 'local', 'agents__')).toEqual(['agents__fetch'])
  })

  it('treats a project without registrations as empty', async () => {
    const { project } = await setup(JSON.stringify({ projects: {} }))
    expect(await readClaudeScopeServerNames(project, 'local', 'agents__')).toEqual([])
    expect(await readClaudeScopeServerNames(project, 'user', 'agents__')).toEqual([])
  })

  it('returns null for a missing, malformed or unexpected file so callers use the CLI', async () => {
    const { project } = await setup('{ not json')
    expect(await readClaudeScopeServerNames(project, 'user', 'agents__')).toBeNull()
    await setup(JSON.stringify({ mcpServers: [] }))
    expect(await readClaudeScopeServerNames(project, 'user', 'agents__')).toBeNull()
    vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(os.tmpdir(), 'agents-claude-config-missing'))
    expect(await readClaudeScopeServerNames(project, 'user', 'agents__')).toBeNull()
  })
})
