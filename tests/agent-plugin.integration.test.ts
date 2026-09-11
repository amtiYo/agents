import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runPluginExport } from '../src/commands/plugin.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import {
  PLUGIN_MANIFEST_SCHEMA,
  PLUGIN_MCP_SCHEMA,
  buildPluginMcp,
  exportPlugin,
  importPlugin,
  validatePlugin,
  validatePluginName
} from '../src/core/agentPlugin.js'
import { pathExists } from '../src/core/fs.js'

const tempDirs: string[] = []

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-'))
  tempDirs.push(projectRoot)
  await runInit({ projectRoot, force: true })

  const config = await loadAgentsConfig(projectRoot)
  config.mcp.servers = {
    files: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}']
    },
    api: {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer ${COMPANY_TOKEN}' }
    },
    legacy: {
      transport: 'sse',
      url: 'https://mcp.example.com/sse'
    },
    off: {
      transport: 'stdio',
      command: 'unused',
      enabled: false
    }
  }
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('agent plugin export', () => {
  it('writes a manifest and mcp.json that match the specification', async () => {
    const projectRoot = await makeProject()
    const outDir = path.join(projectRoot, 'dist', 'plugin')

    const result = await exportPlugin({ projectRoot, outDir, name: 'team-stack', version: '1.2.3' })

    const manifest = JSON.parse(await readFile(path.join(outDir, 'plugin.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.$schema).toBe(PLUGIN_MANIFEST_SCHEMA)
    expect(manifest.name).toBe('team-stack')
    expect(manifest.version).toBe('1.2.3')

    const mcp = JSON.parse(await readFile(path.join(outDir, 'mcp.json'), 'utf8')) as {
      $schema: string
      mcpServers: Record<string, Record<string, unknown>>
    }
    expect(mcp.$schema).toBe(PLUGIN_MCP_SCHEMA)
    expect(mcp.mcpServers.api?.type).toBe('streamable-http')
    expect(mcp.mcpServers.legacy?.type).toBe('sse')
    expect(mcp.mcpServers.off).toBeUndefined()
    expect(result.serverCount).toBe(3)
  })

  it('rewrites ${PROJECT_ROOT} to ${PLUGIN_ROOT} and does not report it as required env', async () => {
    const projectRoot = await makeProject()
    const outDir = path.join(projectRoot, 'dist', 'plugin')

    const result = await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    const mcp = JSON.parse(await readFile(path.join(outDir, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { args?: string[] }>
    }
    expect(mcp.mcpServers.files?.args).toContain('${PLUGIN_ROOT}')
    expect(result.requiredEnv).toEqual(['COMPANY_TOKEN'])
  })

  it('never exports values from local.json', async () => {
    const projectRoot = await makeProject()
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      `${JSON.stringify({ mcpServers: { api: { headers: { Authorization: 'Bearer real-secret-value' } } } }, null, 2)}\n`,
      'utf8',
    )

    const outDir = path.join(projectRoot, 'dist', 'plugin')
    await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    const raw = await readFile(path.join(outDir, 'mcp.json'), 'utf8')
    expect(raw).not.toContain('real-secret-value')
    expect(raw).toContain('${COMPANY_TOKEN}')
  })

  it('copies skills into the package', async () => {
    const projectRoot = await makeProject()
    const outDir = path.join(projectRoot, 'dist', 'plugin')

    const result = await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    expect(result.skillCount).toBeGreaterThan(0)
    expect(await pathExists(path.join(outDir, 'skills'))).toBe(true)
  })

  it('rejects names the specification does not allow', () => {
    expect(() => { validatePluginName('Team-Stack') }).toThrow()
    expect(() => { validatePluginName('team--stack') }).toThrow()
    expect(() => { validatePluginName('-team') }).toThrow()
    expect(() => { validatePluginName('team.stack') }).not.toThrow()
  })

  it('warns about the deprecated sse transport', () => {
    const { warnings } = buildPluginMcp({ legacy: { transport: 'sse', url: 'https://example.com/sse' } })
    expect(warnings.join(' ')).toContain('deprecated sse transport')
  })
})

describe('agent plugin validate', () => {
  it('accepts a package this CLI produced', async () => {
    const projectRoot = await makeProject()
    const outDir = path.join(projectRoot, 'dist', 'plugin')
    await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    const result = await validatePlugin(outDir)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects unknown top-level manifest fields and bad schemas', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-invalid-'))
    tempDirs.push(dir)
    await writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify({ $schema: 'https://example.com/other.json', name: 'ok-name', components: {} }, null, 2)}\n`,
      'utf8',
    )
    await mkdir(path.join(dir, 'skills', 'demo'), { recursive: true })
    await writeFile(
      path.join(dir, 'skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill for tests.\n---\n\nBody.\n',
      'utf8',
    )

    const result = await validatePlugin(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('$schema')
    expect(result.errors.join(' ')).toContain('components')
  })

  it('rejects an stdio server whose command is an absolute path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-invalid-'))
    tempDirs.push(dir)
    await writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'ok-name' }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(dir, 'mcp.json'),
      `${JSON.stringify(
        { $schema: PLUGIN_MCP_SCHEMA, mcpServers: { bad: { type: 'stdio', command: '/usr/local/bin/server' } } },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const result = await validatePlugin(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('bare name')
  })

  it('rejects a package with no components', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-empty-'))
    tempDirs.push(dir)
    await writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'empty' }, null, 2)}\n`,
      'utf8',
    )

    const result = await validatePlugin(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('at least one skill or MCP server')
  })
})

describe('agent plugin import', () => {
  it('adds servers under the plugin name and leaves existing ones alone', async () => {
    const source = await makeProject()
    const outDir = path.join(source, 'dist', 'plugin')
    await exportPlugin({ projectRoot: source, outDir, name: 'team-stack' })

    const target = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-target-'))
    tempDirs.push(target)
    await runInit({ projectRoot: target, force: true })

    const before = await loadAgentsConfig(target)
    const beforeNames = Object.keys(before.mcp.servers)

    const result = await importPlugin({ projectRoot: target, pluginDir: outDir })

    expect(result.addedServers).toEqual(['team-stack.api', 'team-stack.files', 'team-stack.legacy'])

    const after = await loadAgentsConfig(target)
    for (const name of beforeNames) {
      expect(after.mcp.servers[name]).toBeDefined()
    }
    expect(after.mcp.servers['team-stack.api']?.transport).toBe('http')
    expect(after.mcp.servers['team-stack.legacy']?.transport).toBe('sse')
  })

  it('refuses to import a package that fails validation', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-broken-'))
    tempDirs.push(dir)
    await writeFile(path.join(dir, 'plugin.json'), '{ "name": "broken" }\n', 'utf8')

    const target = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-target-'))
    tempDirs.push(target)
    await runInit({ projectRoot: target, force: true })

    await expect(importPlugin({ projectRoot: target, pluginDir: dir })).rejects.toThrow(/not valid/i)
  })
})

describe('plugin name derivation', () => {
  it('derives a valid name from an awkward directory name', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-'))
    tempDirs.push(dir)
    const projectRoot = path.join(dir, 'My Project.')
    await mkdir(projectRoot, { recursive: true })
    await runInit({ projectRoot, force: true })

    await runPluginExport({ projectRoot, json: true })

    const manifest = JSON.parse(
      await readFile(path.join(projectRoot, 'dist', 'agent-plugin', 'plugin.json'), 'utf8'),
    ) as { name: string }
    expect(manifest.name).toBe('my-project')
    expect(() => { validatePluginName(manifest.name) }).not.toThrow()
  })

  it('rewrites ${PROJECT_ROOT} inside env values too', async () => {
    const projectRoot = await makeProject()
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers.files = {
      transport: 'stdio',
      command: 'server',
      env: { WORKDIR: '${PROJECT_ROOT}/data', TOKEN: '${TEAM_TOKEN}' }
    }
    await saveAgentsConfig(projectRoot, config)

    const outDir = path.join(projectRoot, 'dist', 'plugin')
    const result = await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    const mcp = JSON.parse(await readFile(path.join(outDir, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { env?: Record<string, string> }>
    }
    expect(mcp.mcpServers.files?.env?.WORKDIR).toBe('${PLUGIN_ROOT}/data')
    expect(result.requiredEnv).toContain('TEAM_TOKEN')
    expect(result.requiredEnv).not.toContain('PLUGIN_ROOT')
  })
})

describe('plugin export safety', () => {
  it('refuses to export a literal credential from the committed config', async () => {
    const projectRoot = await makeProject()
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers.api = {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer sk-live-not-a-placeholder' }
    }
    await saveAgentsConfig(projectRoot, config)

    await expect(
      exportPlugin({ projectRoot, outDir: path.join(projectRoot, 'dist', 'plugin'), name: 'team-stack' }),
    ).rejects.toThrow(/literal values that look like credentials/)
  })

  it('exports the same config when the caller opts in', async () => {
    const projectRoot = await makeProject()
    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers.api = {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer sk-live-not-a-placeholder' }
    }
    await saveAgentsConfig(projectRoot, config)

    const outDir = path.join(projectRoot, 'dist', 'plugin')
    await exportPlugin({ projectRoot, outDir, name: 'team-stack', allowLiteralSecrets: true })

    expect(await readFile(path.join(outDir, 'mcp.json'), 'utf8')).toContain('sk-live-not-a-placeholder')
  })

  it('accepts a credential that is a placeholder inside a larger value', () => {
    const { literalSecrets } = buildPluginMcp({
      api: { transport: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer ${TEAM_TOKEN}' } }
    })

    expect(literalSecrets).toEqual([])
  })

  it('normalises ${PROJECT_ROOT} in command and collects variables from cwd', () => {
    const { file, requiredEnv } = buildPluginMcp({
      local: {
        transport: 'stdio',
        command: '${PROJECT_ROOT}/bin/server',
        cwd: '${WORKSPACE_DIR}/data'
      }
    })

    expect(file.mcpServers.local?.command).toBe('${PLUGIN_ROOT}/bin/server')
    expect(requiredEnv).toContain('WORKSPACE_DIR')
  })

  it('drops a skills directory that a later export no longer has', async () => {
    const projectRoot = await makeProject()
    const outDir = path.join(projectRoot, 'dist', 'plugin')

    await exportPlugin({ projectRoot, outDir, name: 'team-stack' })
    expect(await pathExists(path.join(outDir, 'skills'))).toBe(true)

    await rm(path.join(projectRoot, '.agents', 'skills'), { recursive: true, force: true })
    await exportPlugin({ projectRoot, outDir, name: 'team-stack' })

    expect(await pathExists(path.join(outDir, 'skills'))).toBe(false)
  })

  it('rejects a plugin whose server fields have the wrong types', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-typed-'))
    tempDirs.push(dir)
    await writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'typed' }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(dir, 'mcp.json'),
      `${JSON.stringify(
        { $schema: PLUGIN_MCP_SCHEMA, mcpServers: { bad: { type: 'stdio', command: 'server', args: 'not-an-array' } } },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const result = await validatePlugin(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('"args" field that is not an array')
  })
})

describe('plugin secret handling', () => {
  it('refuses a placeholder whose fallback is a literal credential', () => {
    const { literalSecrets } = buildPluginMcp({
      api: {
        transport: 'http',
        url: 'https://x/mcp',
        headers: { Authorization: 'Bearer ${TOKEN:-sk-live-fallback}' }
      }
    })

    expect(literalSecrets).toEqual(['api.headers.Authorization'])
  })

  it('refuses a value that mixes a reference with a literal', () => {
    const { literalSecrets } = buildPluginMcp({
      api: {
        transport: 'http',
        url: 'https://x/mcp',
        headers: { Authorization: '${TOKEN}-sk-live-suffix' }
      }
    })

    expect(literalSecrets).toEqual(['api.headers.Authorization'])
  })

  it('accepts a bare reference behind a scheme word', () => {
    const { literalSecrets } = buildPluginMcp({
      api: { transport: 'http', url: 'https://x/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } }
    })

    expect(literalSecrets).toEqual([])
  })

  it('rejects a remote server whose url is not a string', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-url-'))
    tempDirs.push(dir)
    await writeFile(
      path.join(dir, 'plugin.json'),
      `${JSON.stringify({ $schema: PLUGIN_MANIFEST_SCHEMA, name: 'typed' }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(dir, 'mcp.json'),
      `${JSON.stringify(
        { $schema: PLUGIN_MCP_SCHEMA, mcpServers: { bad: { type: 'streamable-http', url: 42 } } },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const result = await validatePlugin(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('not a string')
  })

  it('restores ${PROJECT_ROOT} in url and headers on import', async () => {
    const source = await makeProject()
    const config = await loadAgentsConfig(source)
    config.mcp.servers = {
      api: {
        transport: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { 'X-Workspace': '${PROJECT_ROOT}' }
      }
    }
    await saveAgentsConfig(source, config)

    const outDir = path.join(source, 'dist', 'plugin')
    await exportPlugin({ projectRoot: source, outDir, name: 'team-stack' })

    const target = await mkdtemp(path.join(os.tmpdir(), 'agents-plugin-target-'))
    tempDirs.push(target)
    await runInit({ projectRoot: target, force: true })
    await importPlugin({ projectRoot: target, pluginDir: outDir })

    const imported = await loadAgentsConfig(target)
    expect(imported.mcp.servers['team-stack.api']?.headers?.['X-Workspace']).toBe('${PROJECT_ROOT}')
  })
})
