import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runRecallAbout,
  runRecallDoctor,
  runRecallGet,
  runRecallIngest,
  runRecallInstall,
  runRecallProject,
  runRecallSearch
} from '../src/commands/recall.js'
import { createDefaultAgentsConfig, loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists } from '../src/core/fs.js'
import { probeServerTools } from '../src/core/mcpProbe.js'
import * as ui from '../src/core/ui.js'
import { ingest } from '../src/recall/ingest.js'
import {
  installRecall,
  recallSkillTemplatePath,
  resolveRecallMcpLaunch,
  RECALL_MCP_SERVER_NAME
} from '../src/recall/install.js'
import { handleRecallMcpRequest, runRecallMcpServer } from '../src/recall/mcp.js'
import { recallSqliteSupported } from '../src/recall/sqlite.js'
import { RECALL_MCP_TOOL_NAMES, recallToolDefinitions } from '../src/recall/tools.js'
import type { RecallHit, RecallTurn } from '../src/recall/types.js'

const tempDirs: string[] = []
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const describeSqlite = recallSqliteSupported() ? describe : describe.skip

afterEach(async () => {
  ui.resetContext()
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

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
    process.stdout.write = originalWrite
  }

  return chunks.join('')
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {}
): { status: number | null; stdout: string; stderr: string } {
  const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
  const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENTS_NO_UPDATE_CHECK: '1',
      ...env
    }
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  }
}

async function seedIndex(): Promise<{ home: string; app: string; other: string; indexPath: string }> {
  const home = await tempDir('agents-recall-cli-home-')
  const app = path.join(home, 'work', 'app')
  const other = path.join(home, 'work', 'other')
  await mkdir(app, { recursive: true })
  await mkdir(other, { recursive: true })
  const sessionPath = path.join(home, '.claude', 'projects', '-tmp-app', 'sess-cli.jsonl')
  await mkdir(path.dirname(sessionPath), { recursive: true })
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-cli',
        cwd: app,
        timestamp: '2026-03-14T10:00:00Z',
        message: { content: 'How did we roll back OmniRoute last time?' }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-cli',
        cwd: app,
        timestamp: '2026-03-14T10:00:05Z',
        message: { content: 'Use the digest pull for OmniRoute.' }
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-other',
        cwd: other,
        timestamp: '2026-03-14T11:00:00Z',
        message: { content: 'unrelated MOV-999 secret in another project' }
      })
    ].join('\n') + '\n',
    'utf8'
  )
  const indexPath = path.join(home, 'recall', 'index.sqlite')
  const result = await ingest({ homeDir: home, env: {}, indexPath })
  expect(result.errors).toEqual([])
  expect(result.turnsIndexed).toBeGreaterThan(0)
  return { home, app, other, indexPath }
}

describe('agents recall CLI parsing', () => {
  it('lists about, project, search, get, doctor, ingest, reindex, mcp, and install', () => {
    const help = runCli(['recall', '--help'])
    expect(help.status).toBe(0)
    for (const name of ['about', 'project', 'search', 'get', 'doctor', 'ingest', 'reindex', 'mcp', 'install']) {
      expect(help.stdout).toContain(name)
    }
    expect(help.stdout).not.toContain('remember')
  })

  it('documents --json, --limit, and --all on search', () => {
    const help = runCli(['recall', 'search', '--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--json')
    expect(help.stdout).toContain('--limit')
    expect(help.stdout).toContain('--all')
    expect(help.stdout).toContain('--project')
  })

  it('documents --json and --yes on install', () => {
    const help = runCli(['recall', 'install', '--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--json')
    expect(help.stdout).toContain('--yes')
    expect(help.stdout).toContain('--non-interactive')
  })

  it('rejects a non-integer --limit', () => {
    const result = runCli(['recall', 'search', 'OmniRoute', '--json', '--limit', 'nope'])
    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/--limit/)
  })
})

describe('agents recall JSON shape', () => {
  it('prints JSON for about and project', async () => {
    const home = await tempDir('agents-recall-about-')
    const indexPath = path.join(home, 'index.sqlite')

    const aboutOut = await captureStdout(async () => {
      await runRecallAbout({ json: true, homeDir: home, indexPath })
    })
    expect(() => JSON.parse(aboutOut)).not.toThrow()

    const projectOut = await captureStdout(async () => {
      await runRecallProject({ json: true, cwd: home, homeDir: home, indexPath })
    })
    expect(() => JSON.parse(projectOut)).not.toThrow()
  })
})

describeSqlite('agents recall search/get/doctor JSON', () => {
  it('prints a stable search envelope, get turn, and doctor stats', async () => {
    const { home, app, other, indexPath } = await seedIndex()

    const searchOut = await captureStdout(async () => {
      await runRecallSearch({
        json: true,
        query: 'OmniRoute',
        limit: 5,
        cwd: app,
        homeDir: home,
        indexPath
      })
    })
    const searched = JSON.parse(searchOut) as {
      query: string
      all: boolean
      project: string | null
      limit: number
      hits: RecallHit[]
    }
    expect(searched.query).toBe('OmniRoute')
    expect(searched.all).toBe(false)
    expect(searched.project).toBe(app)
    expect(searched.limit).toBe(5)
    expect(searched.hits.length).toBeGreaterThan(0)
    expect(searched.hits.some((hit) => hit.sessionId === 'sess-other')).toBe(false)
    expect(searched.hits[0]).toEqual(
      expect.objectContaining({
        provider: expect.any(String),
        sessionId: expect.any(String),
        turn: expect.any(Number),
        role: expect.any(String),
        quote: expect.any(String)
      })
    )

    const allOut = await captureStdout(async () => {
      await runRecallSearch({
        json: true,
        query: 'MOV-999',
        all: true,
        cwd: app,
        homeDir: home,
        indexPath
      })
    })
    const allHits = JSON.parse(allOut) as { all: boolean; hits: RecallHit[] }
    expect(allHits.all).toBe(true)
    expect(allHits.hits.some((hit) => hit.sessionId === 'sess-other')).toBe(true)
    expect(allHits.hits[0]?.project).toBe(other)

    const getOut = await captureStdout(async () => {
      await runRecallGet({
        json: true,
        sessionId: 'sess-cli',
        turn: 1,
        homeDir: home,
        indexPath
      })
    })
    const turn = JSON.parse(getOut) as RecallTurn
    expect(turn.sessionId).toBe('sess-cli')
    expect(turn.turn).toBe(1)
    expect(turn.text).toContain('OmniRoute')

    const missingOut = await captureStdout(async () => {
      await runRecallGet({
        json: true,
        sessionId: 'does-not-exist',
        turn: 1,
        homeDir: home,
        indexPath
      })
    })
    expect(JSON.parse(missingOut)).toBeNull()

    const doctorOut = await captureStdout(async () => {
      await runRecallDoctor({ json: true, homeDir: home, indexPath })
    })
    const stats = JSON.parse(doctorOut) as {
      indexPath: string
      files: number
      turns: number
      redacted: number
      skippedSubagents: number
      wal: boolean
      providers: Record<string, { files: number; turns: number }>
    }
    expect(stats.indexPath).toBe(indexPath)
    expect(stats.files).toBeGreaterThan(0)
    expect(stats.turns).toBeGreaterThan(0)
    expect(stats.wal).toBe(true)
    expect(stats.providers.claude.turns).toBeGreaterThan(0)

    const ingestOut = await captureStdout(async () => {
      await runRecallIngest({ json: true, homeDir: home, indexPath })
    })
    const ingested = JSON.parse(ingestOut) as {
      filesSeen: number
      filesIndexed: number
      filesUnchanged: number
      turnsIndexed: number
      errors: unknown[]
    }
    expect(ingested.filesUnchanged).toBeGreaterThan(0)
    expect(ingested.errors).toEqual([])
  })

  it('honours --json --limit and --all through commander', async () => {
    const { home, app, indexPath } = await seedIndex()
    const result = runCli(
      ['recall', 'search', 'OmniRoute', '--json', '--limit', '3', '--project', app],
      {
        AGENTS_HOME_DIR: home,
        AGENTS_RECALL_INDEX: indexPath
      }
    )
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { query: string; limit: number; all: boolean; hits: RecallHit[] }
    expect(parsed.query).toBe('OmniRoute')
    expect(parsed.limit).toBe(3)
    expect(parsed.all).toBe(false)
    expect(parsed.hits.length).toBeGreaterThan(0)
    expect(parsed.hits.length).toBeLessThanOrEqual(3)
  })
})

describe('recall MCP tools', () => {
  it('exposes about, project, search, and get only', () => {
    expect(recallToolDefinitions().map((tool) => tool.name)).toEqual([...RECALL_MCP_TOOL_NAMES])
    expect(RECALL_MCP_TOOL_NAMES).toEqual(['about', 'project', 'search', 'get'])
  })

  it('answers initialize, discover, tools/list, and about over JSON-RPC', async () => {
    const home = await tempDir('agents-recall-mcp-about-')
    const indexPath = path.join(home, 'index.sqlite')
    const ctx = { homeDir: home, indexPath, cwd: home }

    const init = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
    }, ctx) as { result: { protocolVersion: string; capabilities: { tools: unknown } } }
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities.tools).toBeDefined()

    const discover = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'server/discover'
    }, ctx) as { result: { supportedVersions: string[]; resultType: string } }
    expect(discover.result.resultType).toBe('complete')
    expect(discover.result.supportedVersions).toContain('2026-07-28')
    expect(discover.result.supportedVersions).toContain('2025-06-18')

    const listed = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list'
    }, ctx) as { result: { tools: Array<{ name: string }> } }
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(['about', 'project', 'search', 'get'])
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain('remember')

    const about = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'about', arguments: {} }
    }, ctx) as { result: { isError: boolean; content: Array<{ type: string; text: string }> } }
    expect(about.result.isError).toBe(false)
    expect(() => JSON.parse(about.result.content[0]?.text ?? '')).not.toThrow()

    const notified = await handleRecallMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)
    expect(notified).toBeUndefined()

    const unknown = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'remember', arguments: { text: 'nope' } }
    }, ctx) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(unknown.result.isError).toBe(true)
    expect(unknown.result.content[0]?.text).toContain('Unknown recall tool')
  })

  it('serves NDJSON on stdio until stdin closes', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let output = ''
    stdout.on('data', (chunk: Buffer | string) => {
      output += String(chunk)
    })

    const running = runRecallMcpServer({ stdin, stdout })
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)
    stdin.end()
    await running

    const messages = output
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { result?: { tools?: Array<{ name: string }> } })
    expect(messages[0]?.result?.tools?.map((tool) => tool.name)).toEqual(['about', 'project', 'search', 'get'])
  })
})

describeSqlite('recall MCP search/get tools', () => {
  it('returns the same search envelope as the CLI', async () => {
    const { home, app, indexPath } = await seedIndex()
    const called = await handleRecallMcpRequest({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'search',
        arguments: { query: 'OmniRoute', limit: 5, cwd: app }
      }
    }, { homeDir: home, indexPath, cwd: app }) as {
      result: {
        isError: boolean
        structuredContent: { query: string; all: boolean; hits: RecallHit[] }
      }
    }
    expect(called.result.isError).toBe(false)
    expect(called.result.structuredContent.query).toBe('OmniRoute')
    expect(called.result.structuredContent.all).toBe(false)
    expect(called.result.structuredContent.hits.length).toBeGreaterThan(0)
  })
})

describe('recall MCP probe handshake', () => {
  it('lists tools through the CLI stdio probe', async () => {
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const result = await probeServerTools(
      {
        name: 'agents-recall',
        transport: 'stdio',
        command: process.execPath,
        args: ['--import', 'tsx', cliPath, 'recall', 'mcp'],
        cwd: repoRoot
      },
      12_000
    )
    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.tools.map((tool) => tool.name)).toEqual(['about', 'project', 'search', 'get'])
  }, 20_000)
})

const INSTALL_ENV_KEYS = [
  'AGENTS_HOME_DIR',
  'AGENTS_NO_UPDATE_CHECK',
  'NO_COLOR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'AGENTS_RECALL_DIR',
  'AGENTS_RECALL_INDEX',
  'AGENTS_CODEX_CONFIG_PATH',
  'AGENTS_GOOSE_CONFIG_PATH',
  'AGENTS_CLAUDE_DESKTOP_CONFIG_PATH',
  'AGENTS_WINDSURF_MCP_PATH',
  'AGENTS_ANTIGRAVITY_MCP_PATH',
  'AGENTS_OPENCODE_CONFIG_PATH',
  'AGENTS_GROK_TRUSTED_FOLDERS_PATH',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'GROK_HOME',
  'GEMINI_CLI_HOME',
  'GEMINI_CONFIG_DIR',
  'ASIDE_HOME',
  'OPENCODE_DATA_DIR',
  'CURSOR_CONFIG_DIR',
  'CURSOR_USER_DIR',
  'CURSOR_STATE_DB_PATH'
] as const

function isolatedRecallEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of INSTALL_ENV_KEYS) {
    delete env[key]
  }
  env.AGENTS_HOME_DIR = home
  env.AGENTS_NO_UPDATE_CHECK = '1'
  env.NO_COLOR = '1'
  env.XDG_CONFIG_HOME = path.join(home, '.config')
  env.XDG_DATA_HOME = path.join(home, '.local', 'share')
  env.AGENTS_RECALL_INDEX = path.join(home, '.local', 'share', 'agents', 'recall', 'index.sqlite')
  env.AGENTS_CODEX_CONFIG_PATH = path.join(home, '.codex', 'config.toml')
  env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = path.join(home, 'claude_desktop_config.json')
  env.AGENTS_WINDSURF_MCP_PATH = path.join(home, 'windsurf_mcp.json')
  env.AGENTS_GOOSE_CONFIG_PATH = path.join(home, '.config', 'goose', 'config.yaml')
  env.AGENTS_ANTIGRAVITY_MCP_PATH = path.join(home, '.gemini', 'antigravity', 'mcp_config.json')
  return env
}

describe('recall MCP launch spec', () => {
  it('uses process.argv[1] when it is the agents CLI entry', () => {
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
    const launch = resolveRecallMcpLaunch({
      argv: [process.execPath, cliPath, 'recall', 'install'],
      argv1: cliPath,
      execArgv: ['--import', 'tsx'],
      execPath: process.execPath
    })
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual(['--import', 'tsx', cliPath, 'recall', 'mcp'])
  })

  it('falls back to this package cli when argv[1] is another program', () => {
    const launch = resolveRecallMcpLaunch({
      argv: [process.execPath, '/usr/bin/vitest', 'run'],
      argv1: '/usr/bin/vitest',
      execArgv: [],
      execPath: process.execPath
    })
    expect(launch.command).toBe(process.execPath)
    expect(launch.args.at(-2)).toBe('recall')
    expect(launch.args.at(-1)).toBe('mcp')
    expect(launch.args.at(-3)).toMatch(/cli\.(ts|js)$/)
  })
})

describeSqlite('agents recall install', () => {
  const previousEnv = new Map<string, string | undefined>()

  afterEach(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    previousEnv.clear()
  })

  function applyHomeEnv(home: string): NodeJS.ProcessEnv {
    const env = isolatedRecallEnv(home)
    for (const key of INSTALL_ENV_KEYS) {
      if (!previousEnv.has(key)) previousEnv.set(key, process.env[key])
      const value = env[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    return env
  }

  async function seedGlobalHome(home: string): Promise<void> {
    await saveAgentsConfig(
      home,
      createDefaultAgentsConfig({
        enabledIntegrations: ['cursor'],
        mcpServers: {}
      }),
    )
  }

  it('installs the skill and MCP into ~/.agents and syncs without touching cwd', async () => {
    const home = await tempDir('agents-recall-install-home-')
    const work = await tempDir('agents-recall-install-work-')
    applyHomeEnv(home)
    await seedGlobalHome(home)

    const result = await installRecall({
      homeDir: home,
      env: {},
      indexPath: process.env.AGENTS_RECALL_INDEX
    })

    expect(result.initialized).toBe(false)
    expect(result.mcp.name).toBe(RECALL_MCP_SERVER_NAME)
    expect(result.mcp.command).toBe(process.execPath)
    expect(result.mcp.args).toContain('recall')
    expect(result.mcp.args).toContain('mcp')
    expect(result.mcp.args.some((arg) => /cli\.(ts|js)$/.test(arg))).toBe(true)

    const skillPath = path.join(home, '.agents', 'skills', 'recall', 'SKILL.md')
    expect(result.skillPath).toBe(skillPath)
    expect(await readFile(skillPath, 'utf8')).toBe(await readFile(recallSkillTemplatePath(), 'utf8'))

    const config = await loadAgentsConfig(home)
    expect(config.mcp.servers[RECALL_MCP_SERVER_NAME]?.transport).toBe('stdio')
    expect(config.mcp.servers[RECALL_MCP_SERVER_NAME]?.command).toBe(process.execPath)
    expect(config.mcp.servers[RECALL_MCP_SERVER_NAME]?.args).toEqual(result.mcp.args)

    expect(await pathExists(path.join(home, '.cursor', 'mcp.json'))).toBe(true)
    const cursorMcp = JSON.parse(await readFile(path.join(home, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command?: string; args?: string[] }>
    }
    expect(cursorMcp.mcpServers[RECALL_MCP_SERVER_NAME]?.command).toBe(process.execPath)
    expect(cursorMcp.mcpServers[RECALL_MCP_SERVER_NAME]?.args).toContain('recall')

    expect(await pathExists(path.join(work, '.agents'))).toBe(false)
    expect(await pathExists(path.join(repoRoot, '.agents', 'skills', 'recall'))).toBe(false)
  })

  it('initializes ~/.agents when missing and is idempotent', async () => {
    const home = await tempDir('agents-recall-install-init-')
    applyHomeEnv(home)

    const first = await installRecall({
      homeDir: home,
      env: {},
      indexPath: process.env.AGENTS_RECALL_INDEX,
      argv: [process.execPath, fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'recall', 'install'],
      execArgv: ['--import', 'tsx']
    })
    expect(first.initialized).toBe(true)
    expect(await pathExists(path.join(home, '.agents', 'agents.json'))).toBe(true)

    const second = await installRecall({
      homeDir: home,
      env: {},
      indexPath: process.env.AGENTS_RECALL_INDEX,
      argv: [process.execPath, fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'recall', 'install'],
      execArgv: ['--import', 'tsx']
    })
    expect(second.initialized).toBe(false)
    const config = await loadAgentsConfig(home)
    expect(config.mcp.servers[RECALL_MCP_SERVER_NAME]?.args).toEqual(second.mcp.args)
  }, 30_000)

  it('prints JSON from runRecallInstall --yes and through commander', async () => {
    const home = await tempDir('agents-recall-install-cli-')
    const env = applyHomeEnv(home)
    await seedGlobalHome(home)

    const printed = await captureStdout(async () => {
      await runRecallInstall({
        json: true,
        yes: true,
        nonInteractive: true,
        homeDir: home,
        env: {},
        indexPath: process.env.AGENTS_RECALL_INDEX
      })
    })
    const payload = JSON.parse(printed) as {
      mcp: { name: string; args: string[] }
      skillPath: string
      ingest: { errors: unknown[] }
    }
    expect(payload.mcp.name).toBe(RECALL_MCP_SERVER_NAME)
    expect(payload.skillPath).toContain(`${path.sep}.agents${path.sep}skills${path.sep}recall${path.sep}SKILL.md`)
    expect(payload.ingest.errors).toEqual([])

    const cli = runCli(['recall', 'install', '--yes', '--json'], env)
    expect(cli.status).toBe(0)
    const cliPayload = JSON.parse(cli.stdout) as { mcp: { name: string; command: string; args: string[] } }
    expect(cliPayload.mcp.name).toBe(RECALL_MCP_SERVER_NAME)
    expect(cliPayload.mcp.command).toBe(process.execPath)
    expect(cliPayload.mcp.args).toContain('recall')
    expect(cliPayload.mcp.args).toContain('mcp')
  }, 30_000)
})
