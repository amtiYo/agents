import os from 'node:os'
import path from 'node:path'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists, writeTextAtomic } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('atomic writes keep the permissions of the file they replace', () => {
  it('does not widen a config the user restricted to 0600', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mode-'))
    tempDirs.push(dir)
    const target = path.join(dir, 'config.yaml')

    await writeFile(target, 'secret: value\n', 'utf8')
    await chmod(target, 0o600)

    await writeTextAtomic(target, 'secret: other\n')

    expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('leaves a new file at the umask default', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-mode-'))
    tempDirs.push(dir)
    const target = path.join(dir, 'fresh.json')

    await writeTextAtomic(target, '{}\n')

    // Whatever the umask says, not a mode this CLI chose: a umask of 0077 legitimately
    // produces 0600 here, and the old assertion called that a failure.
    const umask = process.umask()
    expect(await pathExists(target)).toBe(true)
    expect((await stat(target)).mode & 0o777).toBe(0o666 & ~umask)
  })
})

describe('flat skill bridge and symlinks that leave the project', () => {
  it('leaves out a skill linking outside .agents/skills instead of copying the target', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skill-link-'))
    tempDirs.push(projectRoot)
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agents-outside-'))
    tempDirs.push(outside)

    const secretFile = path.join(outside, 'id_rsa')
    await writeFile(secretFile, 'PRIVATE-KEY-CONTENT\n', 'utf8')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'notes')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: notes\ndescription: takes notes\n---\n\nNotes.\n',
      'utf8',
    )
    await symlink(secretFile, path.join(skillDir, 'leak.txt'))

    const result = await performSync({ projectRoot, check: false, verbose: false })

    const bridge = path.join(projectRoot, '.gemini', 'skills')
    expect(await pathExists(path.join(bridge, 'notes'))).toBe(false)
    expect(result.warnings.join(' ')).toContain('links outside the project')

    // The skills that stay inside the tree are still bridged.
    expect(await pathExists(path.join(bridge, 'skill-guide', 'SKILL.md'))).toBe(true)
  })

  it('keeps the bridge in sync when a skill is excluded, instead of reporting drift forever', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skill-link-'))
    tempDirs.push(projectRoot)
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agents-outside-'))
    tempDirs.push(outside)
    await writeFile(path.join(outside, 'secret.txt'), 'content\n', 'utf8')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'notes')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: notes\ndescription: takes notes\n---\n\nNotes.\n',
      'utf8',
    )
    await symlink(path.join(outside, 'secret.txt'), path.join(skillDir, 'leak.txt'))

    await performSync({ projectRoot, check: false, verbose: false })
    const second = await performSync({ projectRoot, check: true, verbose: false })

    expect(second.changed).not.toContain('.gemini/skills')
  })
})

describe('secrets stay out of files the sync does not gitignore', () => {
  it('reads back the committed value for Amp while Codex keeps the resolved one', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-leak-mixed-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['amp', 'codex']
    config.mcp.servers = {
      probe: { transport: 'stdio', command: 'node', args: ['s.js'], env: { TOKEN: '${TOKEN}' } }
    }
    await saveAgentsConfig(projectRoot, config)
    await writeFile(
      path.join(projectRoot, '.agents', 'local.json'),
      `${JSON.stringify({ mcpServers: { probe: { env: { TOKEN: 'sk-live-mixed-9876543210' } } } }, null, 2)}\n`,
      'utf8',
    )

    await performSync({ projectRoot, check: false, verbose: false })

    const amp = await readFile(path.join(projectRoot, '.amp', 'settings.json'), 'utf8')
    const codex = await readFile(path.join(projectRoot, '.codex', 'config.toml'), 'utf8')
    expect(amp).not.toContain('sk-live-mixed-9876543210')
    expect(codex).toContain('sk-live-mixed-9876543210')
  })
})

describe('a symlinked directory inside the project', () => {
  it('is walked when looking for a link that leaves the project', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skill-nested-link-'))
    tempDirs.push(projectRoot)
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agents-outside-'))
    tempDirs.push(outside)
    await writeFile(path.join(outside, 'id_rsa'), 'PRIVATE-KEY-CONTENT\n', 'utf8')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    // The escaping link hides one level down, behind a symlink to a directory that is
    // itself inside the project. The copy dereferences both.
    const shared = path.join(projectRoot, 'shared')
    await mkdir(shared, { recursive: true })
    await symlink(path.join(outside, 'id_rsa'), path.join(shared, 'leak.txt'))

    const skillDir = path.join(projectRoot, '.agents', 'skills', 'notes')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: notes\ndescription: takes notes\n---\n\nNotes.\n',
      'utf8',
    )
    await symlink(path.relative(skillDir, shared), path.join(skillDir, 'inner'))

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('links outside the project')
    expect(await pathExists(path.join(projectRoot, '.gemini', 'skills', 'notes'))).toBe(false)
  })
})

describe('forged sync state', () => {
  it('ignores a project MCP state entry pointing outside the project', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-forged-state-'))
    tempDirs.push(projectRoot)
    const outside = await mkdtemp(path.join(os.tmpdir(), 'agents-outside-'))
    tempDirs.push(outside)

    const victim = path.join(outside, 'claude_desktop_config.json')
    await writeFile(victim, `${JSON.stringify({ mcpServers: { important: { command: 'node' } } }, null, 2)}\n`, 'utf8')

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    const statePath = path.join(projectRoot, '.agents', 'generated', 'project-mcp.state.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify({ files: { [victim]: ['important'] } }, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(victim)).toBe(true)
    const kept = await readFile(victim, 'utf8')
    expect(kept).toContain('important')
  })

  it('ignores a state entry naming another file inside the project', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-forged-state-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    // Lexically inside the project, but not a file this CLI ever writes for it.
    const victim = path.join(projectRoot, 'package.json')
    await writeFile(victim, `${JSON.stringify({ name: 'not-ours', mcpServers: {} }, null, 2)}\n`, 'utf8')

    const statePath = path.join(projectRoot, '.agents', 'generated', 'project-mcp.state.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, `${JSON.stringify({ files: { [victim]: ['anything'] } }, null, 2)}\n`, 'utf8')

    await performSync({ projectRoot, check: false, verbose: false })

    const kept = JSON.parse(await readFile(victim, 'utf8')) as { name?: string }
    expect(kept.name).toBe('not-ours')
  })
})
