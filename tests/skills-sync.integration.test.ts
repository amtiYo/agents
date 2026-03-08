import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
})
