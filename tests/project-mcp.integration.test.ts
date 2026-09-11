import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runReset } from '../src/commands/reset.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { performSync } from '../src/core/sync.js'
import { getProjectPaths } from '../src/core/paths.js'
import { pathExists } from '../src/core/fs.js'
import type { AgentsConfig, IntegrationName } from '../src/types.js'

const tempDirs: string[] = []

async function setupProject(
  integrations: IntegrationName[],
  tweak?: (config: AgentsConfig) => void,
): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-project-mcp-'))
  tempDirs.push(projectRoot)

  await runInit({ projectRoot, force: true })

  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = integrations
  config.mcp.servers = {
    docs: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp']
    },
    api: {
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer token' }
    }
  }
  tweak?.(config)
  await saveAgentsConfig(projectRoot, config)

  return projectRoot
}

async function readMcpJson(filePath: string): Promise<{ mcpServers: Record<string, Record<string, unknown>> }> {
  return JSON.parse(await readFile(filePath, 'utf8')) as { mcpServers: Record<string, Record<string, unknown>> }
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('shared project .mcp.json', () => {
  it('writes Claude Code servers to .mcp.json on project scope', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    const result = await performSync({ projectRoot, check: false, verbose: false })

    const payload = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(payload.mcpServers).sort()).toEqual(['api', 'docs'])
    expect(payload.mcpServers.docs?.type).toBe('stdio')
    expect(payload.mcpServers.docs?.tools).toBeUndefined()
    expect(result.warnings.join(' ')).not.toContain('Claude CLI not found')
  })

  it('adds the Copilot CLI tools allowlist when Copilot CLI shares the file', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const payload = await readMcpJson(paths.copilotCliMcp)
    expect(payload.mcpServers.docs?.tools).toEqual(['*'])
    expect(payload.mcpServers.api?.tools).toEqual(['*'])
  })

  it('warns that .mcp.json cannot isolate per-tool targets', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'], (config) => {
      config.mcp.servers.docs = { ...config.mcp.servers.docs, targets: ['claude'] } as never
      config.mcp.servers.api = { ...config.mcp.servers.api, targets: ['copilot_cli'] } as never
    })

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('per-tool targets cannot isolate servers')
    const payload = await readMcpJson(getProjectPaths(projectRoot).copilotCliMcp)
    expect(Object.keys(payload.mcpServers).sort()).toEqual(['api', 'docs'])
  })

  it('warns about double registration when Claude stays on local scope', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'], (config) => {
      config.integrations.options.claudeScope = 'local'
    })

    // The local-scope path shells out to the claude CLI; hide it so the test never
    // touches the developer's real ~/.claude.json.
    const previousPath = process.env.PATH
    process.env.PATH = ''
    let result
    try {
      result = await performSync({ projectRoot, check: false, verbose: false })
    } finally {
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }

    expect(result.warnings.join(' ')).toContain('Servers will appear twice in Claude Code')
  })

  it('writes Copilot CLI to .github/mcp.json when configured, keeping .mcp.json for Claude', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'], (config) => {
      config.integrations.options.copilotCliPath = '.github/mcp.json'
    })
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.copilotCliMcp)).toBe(true)
    const claudeFile = await readMcpJson(paths.copilotCliMcp)
    expect(claudeFile.mcpServers.docs?.tools).toBeUndefined()
  })

  it('keeps hand-written servers and removes only its own on disable', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const payload = await readMcpJson(paths.copilotCliMcp)
    payload.mcpServers.handwritten = { type: 'stdio', command: 'my-server' }
    await writeFile(paths.copilotCliMcp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(after.mcpServers)).toEqual(['handwritten'])
  })

  it('removes the file entirely when it holds nothing but managed servers', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })
    expect(await pathExists(paths.copilotCliMcp)).toBe(true)

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = []
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.copilotCliMcp)).toBe(false)
  })

  it('reports no drift on a second check run', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'])

    await performSync({ projectRoot, check: false, verbose: false })
    const drift = await performSync({ projectRoot, check: true, verbose: false })

    expect(drift.changed).toEqual([])
  })
})

describe('separate Copilot CLI file', () => {
  it('writes both .github/mcp.json and .mcp.json when the paths differ', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'], (config) => {
      config.integrations.options.copilotCliPath = '.github/mcp.json'
    })
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const copilot = await readMcpJson(paths.copilotCliGithubMcp)
    expect(Object.keys(copilot.mcpServers).sort()).toEqual(['api', 'docs'])
    expect(copilot.mcpServers.docs?.tools).toEqual(['*'])

    const claude = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(claude.mcpServers).sort()).toEqual(['api', 'docs'])
    expect(claude.mcpServers.docs?.tools).toBeUndefined()
  })

  it('writes only .github/mcp.json when Claude Code is not enabled', async () => {
    const projectRoot = await setupProject(['copilot_cli'], (config) => {
      config.integrations.options.copilotCliPath = '.github/mcp.json'
    })
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.copilotCliGithubMcp)).toBe(true)
    expect(await pathExists(paths.copilotCliMcp)).toBe(false)
  })

  it('cleans up the previous file when the configured path changes', async () => {
    const projectRoot = await setupProject(['copilot_cli'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })
    expect(await pathExists(paths.copilotCliMcp)).toBe(true)

    const config = await loadAgentsConfig(projectRoot)
    config.integrations.options.copilotCliPath = '.github/mcp.json'
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(paths.copilotCliGithubMcp)).toBe(true)
    expect(await pathExists(paths.copilotCliMcp)).toBe(false)
  })

  it('keeps other top-level keys of an existing .mcp.json', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const payload = JSON.parse(await readFile(paths.copilotCliMcp, 'utf8')) as Record<string, unknown>
    payload.inputs = [{ id: 'token', type: 'promptString' }]
    await writeFile(paths.copilotCliMcp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const after = JSON.parse(await readFile(paths.copilotCliMcp, 'utf8')) as Record<string, unknown>
    expect(after.inputs).toEqual([{ id: 'token', type: 'promptString' }])
  })
})

describe('reset', () => {
  it('removes managed servers from .mcp.json but keeps hand-written ones', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const payload = await readMcpJson(paths.copilotCliMcp)
    payload.mcpServers.handwritten = { type: 'stdio', command: 'my-server' }
    await writeFile(paths.copilotCliMcp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

    await runReset({ projectRoot, localOnly: false, hard: false })

    const after = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(after.mcpServers)).toEqual(['handwritten'])
  })

  it('deletes .mcp.json when it held nothing but managed servers', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })
    await runReset({ projectRoot, localOnly: false, hard: false })

    expect(await pathExists(paths.copilotCliMcp)).toBe(false)
  })
})

describe('upgrading from 0.8.x', () => {
  it('drops a disabled server that an older release left in .mcp.json', async () => {
    const projectRoot = await setupProject(['copilot_cli'])
    const paths = getProjectPaths(projectRoot)

    // A file written by 0.8.x, with no state file next to it.
    await writeFile(
      paths.copilotCliMcp,
      `${JSON.stringify(
        {
          mcpServers: {
            docs: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], tools: ['*'] },
            retired: { type: 'stdio', command: 'old-server', tools: ['*'] }
          }
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const config = await loadAgentsConfig(projectRoot)
    config.mcp.servers.retired = { transport: 'stdio', command: 'old-server', enabled: false }
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(after.mcpServers).sort()).toEqual(['api', 'docs'])
  })

  it('still keeps servers it never wrote when no state file exists', async () => {
    const projectRoot = await setupProject(['copilot_cli'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.copilotCliMcp,
      `${JSON.stringify({ mcpServers: { handwritten: { type: 'stdio', command: 'mine' } } }, null, 2)}\n`,
      'utf8',
    )

    await performSync({ projectRoot, check: false, verbose: false })

    const after = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(after.mcpServers).sort()).toEqual(['api', 'docs', 'handwritten'])
  })
})

describe('reset for projects synced by an older release', () => {
  it('removes managed servers from .mcp.json even without a state file', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.copilotCliMcp,
      `${JSON.stringify(
        {
          mcpServers: {
            docs: { type: 'stdio', command: 'npx' },
            handwritten: { type: 'stdio', command: 'mine' }
          }
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    await rm(path.join(projectRoot, '.agents', 'generated'), { recursive: true, force: true })

    await runReset({ projectRoot, localOnly: false, hard: false })

    const after = await readMcpJson(paths.copilotCliMcp)
    expect(Object.keys(after.mcpServers)).toEqual(['handwritten'])
  })
})

describe('first sync into an existing .mcp.json', () => {
  it('warns before replacing a hand-written server of the same name', async () => {
    const projectRoot = await setupProject(['claude'])
    const paths = getProjectPaths(projectRoot)

    await writeFile(
      paths.copilotCliMcp,
      `${JSON.stringify({ mcpServers: { docs: { type: 'stdio', command: 'my-own-docs-server' } } }, null, 2)}\n`,
      'utf8',
    )

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('already had a server named "docs"')
    const after = await readMcpJson(paths.copilotCliMcp)
    expect(after.mcpServers.docs?.command).toBe('npx')
  })

  it('keeps the generated preview separated per file', async () => {
    const projectRoot = await setupProject(['claude', 'copilot_cli'], (config) => {
      config.integrations.options.copilotCliPath = '.github/mcp.json'
    })
    const paths = getProjectPaths(projectRoot)

    await performSync({ projectRoot, check: false, verbose: false })

    const preview = JSON.parse(await readFile(paths.generatedClaudeProjectMcp, 'utf8')) as {
      files: Record<string, Record<string, unknown>>
    }
    expect(Object.keys(preview.files).sort()).toEqual(['.github/mcp.json', '.mcp.json'])
  })
})
