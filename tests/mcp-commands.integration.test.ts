import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runMcpAdd } from '../src/commands/mcp-add.js'
import { runMcpImport } from '../src/commands/mcp-import.js'
import { runMcpList } from '../src/commands/mcp-list.js'
import { runMcpRemove } from '../src/commands/mcp-remove.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

interface AgentsFile {
  mcp: {
    servers: Record<string, { args?: string[]; command?: string; env?: Record<string, string> }>
  }
  lastSync?: string
}

interface LocalFile {
  mcpServers: Record<string, { args?: string[]; env?: Record<string, string> }>
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('mcp command integration', () => {
  it('adds, imports, lists, and removes MCP servers', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-cmds-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    await runMcpAdd({
      projectRoot,
      name: 'context7',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp', '--api-key', 'secret'],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: ['3=secret'],
      targets: [],
      disabled: false,
      replace: false,
      noSync: false,
      nonInteractive: true
    })

    const configAfterAdd = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as AgentsFile
    const localAfterAdd = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'local.json'), 'utf8')) as LocalFile

    expect(configAfterAdd.mcp.servers.context7).toBeDefined()
    expect(configAfterAdd.mcp.servers.context7.args[3]).toMatch(/^\$\{[A-Z0-9_]+\}$/)
    expect(localAfterAdd.mcpServers.context7.args[3]).toBe('secret')
    expect(typeof configAfterAdd.lastSync).toBe('string')

    await runMcpImport({
      projectRoot,
      json: JSON.stringify({
        mcpServers: {
          docs: {
            url: 'https://example.com/mcp'
          }
        }
      }),
      file: undefined,
      name: undefined,
      targets: [],
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    const listed = await captureStdout(async () => {
      await runMcpList({
        projectRoot,
        json: true
      })
    })
    const parsedList = JSON.parse(listed) as { servers: Array<{ name: string }> }
    const names = parsedList.servers.map((entry) => entry.name)
    expect(names).toContain('context7')
    expect(names).toContain('docs')

    await runMcpRemove({
      projectRoot,
      name: 'context7',
      ignoreMissing: false,
      noSync: true
    })

    const configAfterRemove = JSON.parse(
      await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8'),
    ) as AgentsFile
    expect(configAfterRemove.mcp.servers.context7).toBeUndefined()
    expect(configAfterRemove.mcp.servers.docs).toBeDefined()

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })
    expect(check.changed).toHaveLength(0)
  })

  it('auto-imports MCP payload when add receives a URL', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-cmds-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            mcpServers: {
              context7: {
                command: ['npx', '-y', '@upstash/context7-mcp']
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

    await runMcpAdd({
      projectRoot,
      name: 'https://mcpservers.org/servers/upstash/context7-mcp',
      args: [],
      env: [],
      headers: [],
      secretEnv: [],
      secretHeaders: [],
      secretArgs: [],
      targets: [],
      disabled: false,
      replace: false,
      noSync: true,
      nonInteractive: true
    })

    const config = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8')) as AgentsFile
    expect(config.mcp.servers.context7).toBeDefined()
    expect(config.mcp.servers.context7.command).toBe('npx')
  })

  it('prompts for template secret values during interactive import and allows skipping', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-mcp-cmds-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            mcpServers: {
              'my-repo': {
                command: 'node',
                args: ['/absolute/path/to/generated/server.mjs'],
                env: {
                  GITHUB_TOKEN: 'ghp_xxxx'
                }
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

    const promptedMessages: string[] = []

    await runMcpImport({
      projectRoot,
      url: 'https://mcpservers.org/servers/nirholas/github-to-mcp',
      targets: [],
      replace: false,
      noSync: true,
      nonInteractive: false,
      promptSecretValue: async (message: string) => {
        promptedMessages.push(message)
        return ''
      }
    })

    expect(promptedMessages.length).toBeGreaterThan(0)

    const config = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'agents.json'), 'utf8')) as AgentsFile
    const local = JSON.parse(await readFile(path.join(projectRoot, '.agents', 'local.json'), 'utf8')) as LocalFile

    expect(config.mcp.servers['my-repo']).toBeDefined()
    expect(config.mcp.servers['my-repo']?.env?.GITHUB_TOKEN).toBe('${GITHUB_TOKEN}')
    expect(local.mcpServers['my-repo']?.env?.GITHUB_TOKEN).toBeUndefined()
  })
})

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = []
  const originalWrite = process.stdout.write.bind(process.stdout)
  ;(process.stdout.write as unknown as (chunk: string) => boolean) = ((chunk: string) => {
    chunks.push(chunk)
    return true
  }) as unknown as typeof process.stdout.write

  try {
    await fn()
  } finally {
    ;(process.stdout.write as unknown as typeof process.stdout.write) = originalWrite as unknown as typeof process.stdout.write
  }

  return chunks.join('')
}
