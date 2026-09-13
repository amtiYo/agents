import os from 'node:os'
import path from 'node:path'
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('skills bridge sync', () => {
  it('detects and reports drift for managed copy-mode bridges in check mode', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-sync-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['claude']
    await saveAgentsConfig(projectRoot, config)

    const sourceSkillDir = path.join(projectRoot, '.agents', 'skills', 'team-playbook')
    await mkdir(sourceSkillDir, { recursive: true })
    await writeFile(
      path.join(sourceSkillDir, 'SKILL.md'),
      '---\nname: team-playbook\ndescription: shared flow\n---\n\nUse this skill.\n',
      'utf8'
    )

    const bridgeDir = path.join(projectRoot, '.claude', 'skills')
    await mkdir(path.join(bridgeDir, 'old-skill'), { recursive: true })
    await writeFile(path.join(bridgeDir, 'old-skill', 'SKILL.md'), '# stale\n', 'utf8')
    await writeFile(path.join(bridgeDir, '.agents_bridge'), 'managed-by-agents\n', 'utf8')

    const check = await performSync({
      projectRoot,
      check: true,
      verbose: false
    })

    expect(check.changed).toContain('.claude/skills')

    await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    const mirrored = await readFile(path.join(bridgeDir, 'team-playbook', 'SKILL.md'), 'utf8')
    expect(mirrored).toContain('name: team-playbook')
    expect(await pathExists(path.join(bridgeDir, '.agents_bridge'))).toBe(true)
    expect(await pathExists(path.join(bridgeDir, 'old-skill'))).toBe(false)
  })

  it('flattens nested skills into a physical Antigravity bridge', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-antigravity-skills-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const sourceRoot = path.join(projectRoot, '.agents', 'skills')
    await rm(sourceRoot, { recursive: true, force: true })
    await writeSkill(sourceRoot, 'group-a', 'skill-a', 'Skill A')
    await writeSkill(sourceRoot, 'group-a', 'skill-b', 'Skill B')
    await writeSkill(sourceRoot, undefined, 'skill-c', 'Skill C')

    const bridgePath = path.join(projectRoot, '.gemini', 'skills')
    await mkdir(path.dirname(bridgePath), { recursive: true })
    await symlink(path.relative(path.dirname(bridgePath), sourceRoot), bridgePath)

    await performSync({ projectRoot, check: false, verbose: false })

    const bridgeInfo = await lstat(bridgePath)
    expect(bridgeInfo.isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(bridgePath, 'skill-a', 'SKILL.md'), 'utf8')).toContain('Skill A')
    expect(await readFile(path.join(bridgePath, 'skill-b', 'SKILL.md'), 'utf8')).toContain('Skill B')
    expect(await readFile(path.join(bridgePath, 'skill-c', 'SKILL.md'), 'utf8')).toContain('Skill C')
    expect(await pathExists(path.join(bridgePath, 'group-a'))).toBe(false)
    expect(await pathExists(path.join(bridgePath, '.agents_bridge'))).toBe(true)

    await rm(path.join(sourceRoot, 'group-a', 'skill-b'), { recursive: true, force: true })
    await writeSkill(sourceRoot, undefined, 'skill-c', 'Skill C updated')
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(path.join(bridgePath, 'skill-b'))).toBe(false)
    expect(await readFile(path.join(bridgePath, 'skill-c', 'SKILL.md'), 'utf8')).toContain('Skill C updated')
  })

  it('skips Antigravity flat sync when nested skill names collide', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-antigravity-skills-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const sourceRoot = path.join(projectRoot, '.agents', 'skills')
    await rm(sourceRoot, { recursive: true, force: true })
    await writeSkill(sourceRoot, 'group-a', 'shared-skill', 'A')
    await writeSkill(sourceRoot, 'group-b', 'shared-skill', 'B')

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('skill names must be unique for flat copy mode')
    expect(await pathExists(path.join(projectRoot, '.gemini', 'skills'))).toBe(false)
  })

  it('removes a managed flat bridge when duplicate skill names are introduced', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-antigravity-skills-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const sourceRoot = path.join(projectRoot, '.agents', 'skills')
    await rm(sourceRoot, { recursive: true, force: true })
    await writeSkill(sourceRoot, undefined, 'shared-skill', 'Original')
    await performSync({ projectRoot, check: false, verbose: false })

    const bridgePath = path.join(projectRoot, '.gemini', 'skills')
    expect(await pathExists(bridgePath)).toBe(true)

    await writeSkill(sourceRoot, 'group-b', 'shared-skill', 'Duplicate')
    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.join(' ')).toContain('bridge was removed until duplicate skill names are resolved')
    expect(await pathExists(bridgePath)).toBe(false)
  })

  it('dereferences symlinked skills and linked files in the physical Antigravity bridge', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-antigravity-skills-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['antigravity']
    await saveAgentsConfig(projectRoot, config)

    const sourceRoot = path.join(projectRoot, '.agents', 'skills')
    const externalRoot = path.join(projectRoot, 'external-skills')
    await rm(sourceRoot, { recursive: true, force: true })
    await writeSkill(externalRoot, undefined, 'linked-skill', 'Linked skill')
    const externalSkill = path.join(externalRoot, 'linked-skill')
    const linkedResource = path.join(projectRoot, 'external-resource.md')
    const sharedResourceDir = path.join(projectRoot, 'shared-resources')
    await writeFile(linkedResource, 'linked resource\n', 'utf8')
    await mkdir(sharedResourceDir, { recursive: true })
    await writeFile(path.join(sharedResourceDir, 'shared.md'), 'shared resource\n', 'utf8')
    await symlink(path.relative(externalSkill, linkedResource), path.join(externalSkill, 'RESOURCE.md'))
    await symlink(path.relative(externalSkill, sharedResourceDir), path.join(externalSkill, 'alias-a'))
    await symlink(path.relative(externalSkill, sharedResourceDir), path.join(externalSkill, 'alias-b'))
    await mkdir(sourceRoot, { recursive: true })
    await symlink(path.relative(sourceRoot, externalSkill), path.join(sourceRoot, 'linked-skill'))

    await performSync({ projectRoot, check: false, verbose: false })

    const bridgeSkill = path.join(projectRoot, '.gemini', 'skills', 'linked-skill')
    expect((await lstat(bridgeSkill)).isSymbolicLink()).toBe(false)
    expect((await lstat(path.join(bridgeSkill, 'RESOURCE.md'))).isSymbolicLink()).toBe(false)
    expect(await readFile(path.join(bridgeSkill, 'RESOURCE.md'), 'utf8')).toBe('linked resource\n')
    expect(await readFile(path.join(bridgeSkill, 'alias-a', 'shared.md'), 'utf8')).toBe('shared resource\n')
    expect(await readFile(path.join(bridgeSkill, 'alias-b', 'shared.md'), 'utf8')).toBe('shared resource\n')

    const secondSync = await performSync({ projectRoot, check: false, verbose: false })
    expect(secondSync.changed).not.toContain('.gemini/skills')

    const checkSync = await performSync({ projectRoot, check: true, verbose: false })
    expect(checkSync.changed).not.toContain('.gemini/skills')
  })

  it('bridges skills into Kilo and removes the bridge when the integration is disabled', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-bridges-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['kilo']
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    const bridge = path.join(projectRoot, '.kilo', 'skills')
    expect(await pathExists(bridge)).toBe(true)
    expect(await pathExists(path.join(bridge, 'skill-guide', 'SKILL.md'))).toBe(true)

    const disabled = await loadAgentsConfig(projectRoot)
    disabled.integrations.enabled = ['codex']
    await saveAgentsConfig(projectRoot, disabled)
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(bridge)).toBe(false)
  })

  it('creates no bridge for tools that read .agents/skills themselves', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-native-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['zed', 'goose', 'devin', 'grok', 'droid']
    await saveAgentsConfig(projectRoot, config)

    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(path.join(projectRoot, '.zed', 'skills'))).toBe(false)
    expect(await pathExists(path.join(projectRoot, '.goose', 'skills'))).toBe(false)
    expect(await pathExists(path.join(projectRoot, '.devin', 'skills'))).toBe(false)
    // Droid reports a duplicate skill name when both locations hold the same skill,
    // and Grok reads .agents/skills once the folder is trusted. Neither needs a bridge.
    expect(await pathExists(path.join(projectRoot, '.grok', 'skills'))).toBe(false)
    expect(await pathExists(path.join(projectRoot, '.factory', 'skills'))).toBe(false)
  })

  it('warns that Zed does not discover skills nested in a grouping directory', { timeout: 25000 }, async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-nested-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })
    const config = await loadAgentsConfig(projectRoot)
    config.integrations.enabled = ['zed']
    await saveAgentsConfig(projectRoot, config)

    const skillsRoot = path.join(projectRoot, '.agents', 'skills')
    await writeSkill(skillsRoot, 'group-a', 'deploy-flow', 'grouped skill')

    const withNested = await performSync({ projectRoot, check: false, verbose: false })
    expect(withNested.warnings.join(' ')).toContain('group-a/deploy-flow')
    expect(withNested.warnings.join(' ')).toContain('Zed only discovers skills directly under .agents/skills')

    await rm(path.join(skillsRoot, 'group-a'), { recursive: true, force: true })
    const flat = await performSync({ projectRoot, check: false, verbose: false })
    expect(flat.warnings.join(' ')).not.toContain('Zed only discovers skills')
  })


  it('links the Kilo bridge in global mode instead of falling back to a copy', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-global-'))
    tempDirs.push(fakeHome)
    const previousHome = process.env.AGENTS_HOME_DIR
    process.env.AGENTS_HOME_DIR = fakeHome

    try {
      await runInit({ projectRoot: fakeHome, force: true })
      const config = await loadAgentsConfig(fakeHome)
      config.integrations.enabled = ['kilo']
      await saveAgentsConfig(fakeHome, config)

      const result = await performSync({ projectRoot: fakeHome, check: false, verbose: false })

      // Kilo keeps kilo.jsonc under the XDG config directory and its skills under the
      // home directory, so the bridge parent has to come from the bridge path itself.
      const bridge = path.join(fakeHome, '.kilo', 'skills')
      expect(await pathExists(bridge)).toBe(true)
      expect((await lstat(bridge)).isSymbolicLink()).toBe(true)
      expect(result.warnings.join(' ')).not.toContain('fallback to copy mode')
    } finally {
      if (previousHome === undefined) delete process.env.AGENTS_HOME_DIR
      else process.env.AGENTS_HOME_DIR = previousHome
    }
  })

})

async function writeSkill(
  sourceRoot: string,
  group: string | undefined,
  name: string,
  description: string,
): Promise<void> {
  const skillDir = group
    ? path.join(sourceRoot, group, name)
    : path.join(sourceRoot, name)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${description}\n`,
    'utf8',
  )
}
