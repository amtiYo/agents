import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const promptState = vi.hoisted(() => ({
  confirms: [] as boolean[]
}))

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  spinner: () => ({
    start: vi.fn(),
    stop: vi.fn()
  }),
  isCancel: () => false,
  confirm: vi.fn(async () => (promptState.confirms.length > 0 ? promptState.confirms.shift() ?? true : true)),
  select: vi.fn(async () => 'source-only'),
  multiselect: vi.fn(async () => [])
}))

const { runStart } = await import('../src/commands/start.js')

const tempDirs: string[] = []
let previousPathEnv: string | undefined
let previousCodexConfigPath: string | undefined

afterEach(async () => {
  if (previousPathEnv === undefined) {
    delete process.env.PATH
  } else {
    process.env.PATH = previousPathEnv
  }

  if (previousCodexConfigPath === undefined) {
    delete process.env.AGENTS_CODEX_CONFIG_PATH
  } else {
    process.env.AGENTS_CODEX_CONFIG_PATH = previousCodexConfigPath
  }

  promptState.confirms = []

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('start interactive docs injection prompt', () => {
  it('injects docs block when interactive prompt answer is yes', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-interactive-docs-yes-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-interactive-'))
    tempDirs.push(projectRoot, codexDir)

    previousPathEnv = process.env.PATH
    previousCodexConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
    process.env.PATH = '/dev/null'
    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')

    await writeFile(path.join(projectRoot, 'README.md'), '# Demo Project\n', 'utf8')
    await writeFile(path.join(projectRoot, 'CONTRIBUTING.md'), '# Contributing\n', 'utf8')

    // confirm order: hide-generated, apply setup, docs injection
    promptState.confirms = [true, true, true]
    await runStart({
      projectRoot,
      nonInteractive: false,
      yes: false
    })

    const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
    const contributing = await readFile(path.join(projectRoot, 'CONTRIBUTING.md'), 'utf8')
    expect(readme).toContain('<!-- agents:project-docs:start -->')
    expect(contributing).toContain('<!-- agents:project-docs:start -->')
  })

  it('skips docs block when interactive prompt answer is no', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-start-interactive-docs-no-'))
    const codexDir = await mkdtemp(path.join(os.tmpdir(), 'agents-codex-interactive-'))
    tempDirs.push(projectRoot, codexDir)

    previousPathEnv = process.env.PATH
    previousCodexConfigPath = process.env.AGENTS_CODEX_CONFIG_PATH
    process.env.PATH = '/dev/null'
    process.env.AGENTS_CODEX_CONFIG_PATH = path.join(codexDir, 'config.toml')

    await writeFile(path.join(projectRoot, 'README.md'), '# Demo Project\n', 'utf8')
    await writeFile(path.join(projectRoot, 'CONTRIBUTING.md'), '# Contributing\n', 'utf8')

    // confirm order: hide-generated, apply setup, docs injection
    promptState.confirms = [true, true, false]
    await runStart({
      projectRoot,
      nonInteractive: false,
      yes: false
    })

    const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
    const contributing = await readFile(path.join(projectRoot, 'CONTRIBUTING.md'), 'utf8')
    expect(readme).not.toContain('<!-- agents:project-docs:start -->')
    expect(contributing).not.toContain('<!-- agents:project-docs:start -->')
  })
})
