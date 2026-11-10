import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runReset } from '../src/commands/reset.js'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { getProjectPaths } from '../src/core/paths.js'
import { performSync } from '../src/core/sync.js'
import type { McpServerDefinition } from '../src/types.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function project(servers: Record<string, McpServerDefinition>, opencodeJson?: unknown) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-opencode-sync-'))
  tempDirs.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  vi.stubEnv('PATH', '')
  await saveAgentsConfig(projectRoot, createDefaultAgentsConfig({ enabledIntegrations: ['opencode'], mcpServers: servers }))
  const paths = getProjectPaths(projectRoot)
  await mkdir(paths.generatedDir, { recursive: true })
  if (opencodeJson !== undefined) await writeFile(paths.opencodeConfig, JSON.stringify(opencodeJson))
  return {
    projectRoot,
    paths,
    sync: (check = false) => performSync({ projectRoot, check, verbose: false }),
    read: async () => JSON.parse(await readFile(paths.opencodeConfig, 'utf8')) as {
      mcp: Record<string, unknown> & { servers?: Record<string, unknown> }
      [key: string]: unknown
    },
    state: async () => JSON.parse(await readFile(paths.generatedOpencodeState, 'utf8')) as unknown
  }
}

const docs: McpServerDefinition = { transport: 'stdio', command: 'node', args: ['docs.js'] }
const legacyDocs = { type: 'local', enabled: true, command: ['node', 'docs.js'] }
const v2Docs = { type: 'local', command: ['node', 'docs.js'] }

describe('OpenCode config shape', () => {
  it('writes the legacy shape that every OpenCode version reads by default', async () => {
    const p = await project({ docs, off: { ...docs, opencode: { disabled: true } } })
    await p.sync()
    expect((await p.read()).mcp).toEqual({ docs: legacyDocs, off: { ...legacyDocs, enabled: false } })
    expect(await p.state()).toEqual({ layout: 'legacy', managedNames: ['docs', 'off'] })
  })

  it('writes the V2 shape into a config that already uses mcp.servers', async () => {
    const manual = { type: 'remote', url: 'https://example.com/mcp' }
    const p = await project({ docs }, { theme: 'dark', mcp: { timeout: { startup: 42 }, servers: { manual } } })
    await p.sync()
    const config = await p.read()
    expect(config.theme).toBe('dark')
    expect(config.mcp).toEqual({ timeout: { startup: 42 }, servers: { manual, docs: v2Docs } })
    expect(await p.state()).toEqual({ layout: 'servers', managedNames: ['docs'] })
  })

  it('keeps the legacy shape for a shared timeout and switches for a split one', async () => {
    const p = await project({ docs: { ...docs, timeout: 30000 } })
    await p.sync()
    expect((await p.read()).mcp).toEqual({ docs: { ...legacyDocs, timeout: 30000 } })
    await saveAgentsConfig(p.projectRoot, createDefaultAgentsConfig({ enabledIntegrations: ['opencode'], mcpServers: {
      docs: { ...docs, timeout: 30000, opencode: { timeout: { startup: 60000 } } }
    } }))
    await p.sync()
    expect((await p.read()).mcp).toEqual({ servers: {
      docs: { ...v2Docs, timeout: { startup: 60000, catalog: 30000, execution: 30000 } }
    } })
  })

  it('switches to the V2 shape when a server sets an option only V2 has', async () => {
    const p = await project({ docs: { ...docs, opencode: { protocol: 'auto' } } })
    await p.sync()
    expect((await p.read()).mcp).toEqual({ servers: { docs: { ...v2Docs, protocol: 'auto' } } })
  })

  it('keeps a 0.9.3 config byte for byte when nothing needs V2', async () => {
    const written = `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { docs: legacyDocs } }, null, 2)}\n`
    const p = await project({ docs })
    await writeFile(p.paths.opencodeConfig, written)
    await writeFile(p.paths.generatedOpencodeState, JSON.stringify({ managedNames: ['docs'] }))
    const result = await p.sync()
    expect(await readFile(p.paths.opencodeConfig, 'utf8')).toBe(written)
    expect(result.changed).not.toContain('opencode.json')
  })

  it('moves entries written by 0.9.3 into mcp.servers and leaves manual ones alone', async () => {
    const manual = { type: 'local', command: ['manual'] }
    const p = await project({ docs: { ...docs, opencode: { pool: true } } }, {
      mcp: { docs: legacyDocs, manual }
    })
    await writeFile(p.paths.generatedOpencodeState, JSON.stringify({ managedNames: ['docs'] }))
    await p.sync()
    expect((await p.read()).mcp).toEqual({ manual, servers: { docs: { ...v2Docs, pool: true } } })
  })

  it('adopts 0.9.3 entries from the old preview when no ownership record exists', async () => {
    const edited = { ...legacyDocs, command: ['node', 'edited.js'] }
    const p = await project({ docs }, { mcp: { docs: legacyDocs, other: edited } })
    await writeFile(p.paths.generatedOpencode, JSON.stringify({ mcp: { docs: legacyDocs, other: legacyDocs } }))
    await saveAgentsConfig(p.projectRoot, createDefaultAgentsConfig({ enabledIntegrations: [], mcpServers: { docs } }))
    await p.sync()
    expect((await p.read()).mcp).toEqual({ other: edited })
  })

  it('takes over a same-named manual entry in the other map with a warning', async () => {
    const p = await project({ docs }, { mcp: { docs: { type: 'local', command: ['mine'] }, servers: {} } })
    const result = await p.sync()
    expect((await p.read()).mcp).toEqual({ servers: { docs: v2Docs } })
    expect(result.warnings.join('\n')).toMatch(/OpenCode.*docs/)
  })

  it('removes only its own V2 entries when OpenCode is disabled', async () => {
    const manual = { type: 'local', command: ['manual'] }
    const p = await project({ docs }, { mcp: { servers: { manual } } })
    await p.sync()
    await saveAgentsConfig(p.projectRoot, createDefaultAgentsConfig({ enabledIntegrations: [], mcpServers: { docs } }))
    await p.sync()
    expect((await p.read()).mcp).toEqual({ servers: { manual } })
  })

  it('drops the V2 map it created once its last entry is gone', async () => {
    const p = await project({ docs: { ...docs, opencode: { codemode: true } } }, { theme: 'dark' })
    await p.sync()
    await saveAgentsConfig(p.projectRoot, createDefaultAgentsConfig({ enabledIntegrations: [], mcpServers: { docs } }))
    await p.sync()
    expect(await p.read()).toEqual({ $schema: 'https://opencode.ai/config.json', theme: 'dark', mcp: {} })
  })

  it('keeps an empty mcp.servers that the user added to opt into V2', async () => {
    const p = await project({}, { mcp: { servers: {} } })
    await p.sync()
    expect((await p.read()).mcp).toEqual({ servers: {} })
  })

  it('changes nothing in check mode', async () => {
    const original = JSON.stringify({ mcp: { servers: {} } })
    const p = await project({ docs })
    await writeFile(p.paths.opencodeConfig, original)
    const result = await p.sync(true)
    expect(result.changed).toContain('opencode.json')
    expect(await readFile(p.paths.opencodeConfig, 'utf8')).toBe(original)
  })

  it('still syncs when a sibling opencode.jsonc exists', async () => {
    const p = await project({ docs })
    await writeFile(path.join(p.projectRoot, 'opencode.jsonc'), '{\n  // mine\n}\n')
    await p.sync()
    expect((await p.read()).mcp).toEqual({ docs: legacyDocs })
  })

  it('warns when the legacy shape cannot hold an OAuth setting', async () => {
    const p = await project({ docs: {
      transport: 'http',
      url: 'https://example.com/mcp',
      oauth: { clientId: 'client', authServerMetadataUrl: 'https://auth.example.com' }
    } })
    const result = await p.sync()
    expect((await p.read()).mcp.docs).toEqual({
      type: 'remote', enabled: true, url: 'https://example.com/mcp', oauth: { clientId: 'client' }
    })
    expect(result.warnings.join('\n')).toContain('oauth.auth_server_metadata_url')
  })
})

describe('OpenCode reset', () => {
  it.each([
    ['legacy', {}],
    ['V2', { mcp: { servers: {} } }]
  ])('removes managed entries from the %s shape and keeps manual ones', async (_shape, initial) => {
    const manual = { type: 'local', command: ['manual'] }
    const p = await project({ docs }, initial)
    await p.sync()
    const config = await p.read()
    if (config.mcp.servers) config.mcp.servers.manual = manual
    else config.mcp.manual = manual
    await writeFile(p.paths.opencodeConfig, JSON.stringify(config))
    await runReset({ projectRoot: p.projectRoot, localOnly: false, hard: false })
    const after = await p.read()
    expect(after.mcp.servers ?? after.mcp).toEqual({ manual })
  })
})
