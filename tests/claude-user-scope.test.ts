import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { runStart } from '../src/commands/start.js'
import { runInit } from '../src/commands/init.js'
import { runReset } from '../src/commands/reset.js'
import { createDefaultAgentsConfig, loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { toProjectScopedName } from '../src/core/globalScope.js'
import { performSync } from '../src/core/sync.js'

const cli = vi.hoisted(() => ({
  entries: new Map<string, string[]>(),
  calls: [] as string[][],
  failRemove: false
}))
vi.mock('../src/core/shell.js', () => ({
  commandExists: (command: string) => command === 'claude',
  runCommand: (_command: string, args: string[], cwd: string) => {
    cli.calls.push(args)
    const result = { ok: true, code: 0, stdout: '', stderr: '', timedOut: false }
    if (args[1] === 'list') {
      result.stdout = [...cli.entries.keys()]
        .filter(key => key.startsWith('user:') || key.startsWith(`${cwd}:local:`))
        .map(key => `${key.split(':').at(-1)}: configured`).join('\n')
    }
    const scope = args[3]
    let name = args[4]
    if (args[1] === 'add' && args.includes('-t')) name = args[6]
    const key = scope === 'user' ? `user:${name}` : `${cwd}:local:${name}`
    if (args[1] === 'remove') {
      if (cli.failRemove) return { ...result, ok: false, code: 1, stderr: 'permission denied' }
      cli.entries.delete(key)
    }
    if (args[1] === 'add') cli.entries.set(key, args)
    return result
  }
}))

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  cli.entries.clear()
  cli.calls.length = 0
  cli.failRemove = false
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(scope = 'user') {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-user-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', path.join(projectRoot, 'home'))
  const config = createDefaultAgentsConfig({ enabledIntegrations: ['claude'], mcpServers: {
    docs: { transport: 'http', url: 'https://example.com/mcp', headers: { Authorization: '${TOKEN}' } },
    stdio: { transport: 'stdio', command: 'node', args: ['server.js'], env: { FIXTURE: 'value' } }
  } })
  Object.assign(config.integrations.options, { claudeScope: scope })
  await saveAgentsConfig(projectRoot, config)
  await writeFile(path.join(projectRoot, '.agents/local.json'), JSON.stringify({ mcpServers: {
    docs: { headers: { Authorization: 'Bearer fixture-secret' } }
  } }))
  return { projectRoot, config }
}

it.each(['user', 'global'])('loads %s as user scope and syncs both transports idempotently', async scope => {
  const { projectRoot } = await fixture(scope)
  expect((await loadAgentsConfig(projectRoot)).integrations.options.claudeScope).toBe('user')
  await performSync({ projectRoot, check: false, verbose: false })
  const docsName = toProjectScopedName(projectRoot, 'docs')
  expect(cli.entries.get(`user:${docsName}`)).toEqual([
    'mcp', 'add', '-s', 'user', '-t', 'http', docsName, 'https://example.com/mcp', '-H', 'Authorization: Bearer fixture-secret'
  ])
  expect(cli.entries.get(`user:${toProjectScopedName(projectRoot, 'stdio')}`)).toContain('FIXTURE=value')
  expect(await readFile(path.join(projectRoot, '.agents/generated/claude.state.json'), 'utf8')).not.toContain('fixture-secret')
  expect((await performSync({ projectRoot, check: true, verbose: false })).changed).toEqual([])
  expect(cli.calls.filter(args => args[1] === 'add')).toHaveLength(2)
})

it('removes legacy local registrations before adding user registrations and keeps check read-only', async () => {
  const { projectRoot, config } = await fixture('local')
  await performSync({ projectRoot, check: false, verbose: false })
  // State written before user scope existed has no scope field.
  const statePath = path.join(projectRoot, '.agents/generated/claude.state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  delete state.scope
  await writeFile(statePath, JSON.stringify(state))
  Object.assign(config.integrations.options, { claudeScope: 'user' })
  await saveAgentsConfig(projectRoot, config)
  cli.calls.length = 0
  expect((await performSync({ projectRoot, check: true, verbose: false })).changed).toContain('claude-user-scope')
  expect(cli.calls.every(args => args[1] === 'list')).toBe(true)
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.entries.has(`${projectRoot}:local:agents__docs`)).toBe(false)
  expect(cli.calls.findIndex(args => args[1] === 'remove')).toBeLessThan(cli.calls.findIndex(args => args[1] === 'add'))
  expect(cli.entries.has(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toBe(true)
})

it('retains old scope ownership when migration removal fails and retries', async () => {
  const { projectRoot, config } = await fixture('local')
  await performSync({ projectRoot, check: false, verbose: false })
  Object.assign(config.integrations.options, { claudeScope: 'user' })
  await saveAgentsConfig(projectRoot, config)
  cli.failRemove = true
  await expect(performSync({ projectRoot, check: false, verbose: false })).rejects.toThrow('permission denied')
  expect(cli.entries.has(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toBe(false)
  cli.failRemove = false
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.entries.has(`${projectRoot}:local:agents__docs`)).toBe(false)
  expect(cli.entries.has(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toBe(true)
})

it.each(['project', 'local', 'disabled', 'reset'])('cleans user registrations when switching to %s without touching another project', async target => {
  const { projectRoot, config } = await fixture()
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.entries.has(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toBe(true)
  const foreign = `user:${toProjectScopedName('/other-project', 'docs')}`
  cli.entries.set(foreign, [])
  if (target === 'reset') await runReset({ projectRoot, localOnly: false, hard: false })
  else {
    if (target === 'disabled') config.integrations.enabled = []
    else Object.assign(config.integrations.options, { claudeScope: target })
    await saveAgentsConfig(projectRoot, config)
    await performSync({ projectRoot, check: false, verbose: false })
  }
  expect(cli.entries.has(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toBe(false)
  expect(cli.entries.has(foreign)).toBe(true)
})

it('defaults home installs to user scope and normal repos to project scope', async () => {
  const { projectRoot } = await fixture()
  vi.stubEnv('AGENTS_HOME_DIR', projectRoot)
  await runInit({ projectRoot, force: true })
  expect((await loadAgentsConfig(projectRoot)).integrations.options.claudeScope).toBe('user')
  const repo = path.join(projectRoot, 'repo')
  await runInit({ projectRoot: repo, force: true })
  expect((await loadAgentsConfig(repo)).integrations.options.claudeScope).toBe('project')
})

it('uses user scope for a new home start and preserves an explicit local choice on rerun', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-claude-home-start-'))
  roots.push(projectRoot)
  vi.stubEnv('AGENTS_HOME_DIR', projectRoot)
  vi.stubEnv('AGENTS_CODEX_CONFIG_PATH', path.join(projectRoot, '.codex/config.toml'))
  await runStart({ projectRoot, nonInteractive: true, yes: true })
  const config = await loadAgentsConfig(projectRoot)
  expect(config.integrations.options.claudeScope).toBe('user')
  config.integrations.options.claudeScope = 'local'
  await saveAgentsConfig(projectRoot, config)
  await runStart({ projectRoot, nonInteractive: true, yes: true })
  expect((await loadAgentsConfig(projectRoot)).integrations.options.claudeScope).toBe('local')
})

it('replaces user definitions and retries reset failures without losing ownership', async () => {
  const { projectRoot, config } = await fixture()
  await performSync({ projectRoot, check: false, verbose: false })
  config.mcp.servers.docs.url = 'https://updated.example/mcp'
  await saveAgentsConfig(projectRoot, config)
  expect((await performSync({ projectRoot, check: true, verbose: false })).changed).toContain('claude-user-scope')
  await performSync({ projectRoot, check: false, verbose: false })
  expect(cli.entries.get(`user:${toProjectScopedName(projectRoot, 'docs')}`)).toContain('https://updated.example/mcp')
  cli.failRemove = true
  await expect(runReset({ projectRoot, localOnly: false, hard: false })).rejects.toThrow('permission denied')
  const state = JSON.parse(await readFile(path.join(projectRoot, '.agents/generated/claude.state.json'), 'utf8'))
  expect(state.scope).toBe('user')
  expect(state.managedNames).toContain(toProjectScopedName(projectRoot, 'docs'))
  cli.failRemove = false
  await runReset({ projectRoot, localOnly: false, hard: false })
  expect(cli.entries.size).toBe(0)
})
