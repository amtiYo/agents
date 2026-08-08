import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { validateSkillsDirectory } from '../src/core/skillsValidation.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('skills validation', () => {
  it('accepts valid skill structure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    tempDirs.push(root)
    const skillsDir = path.join(root, '.agents', 'skills')
    const skillDir = path.join(skillsDir, 'skill-guide')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: skill-guide',
        'description: Valid skill',
        '---',
        '',
        'Instructions'
      ].join('\n'),
      'utf8',
    )

    const warnings = await validateSkillsDirectory(skillsDir)
    expect(warnings).toHaveLength(0)
  })

  it('reports invalid/missing frontmatter fields', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    tempDirs.push(root)
    const skillsDir = path.join(root, '.agents', 'skills')
    const skillDir = path.join(skillsDir, 'bad-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), 'no frontmatter\n', 'utf8')

    const warnings = await validateSkillsDirectory(skillsDir)
    expect(warnings.join(' ')).toContain('no YAML frontmatter')
  })

  it('accepts skills nested below grouping directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    tempDirs.push(root)
    const skillDir = path.join(root, '.agents', 'skills', 'group-a', 'nested-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: nested-skill\ndescription: Nested skill\n---\n\nInstructions\n',
      'utf8',
    )

    const warnings = await validateSkillsDirectory(path.join(root, '.agents', 'skills'))
    expect(warnings).toHaveLength(0)
  })

  it('reports duplicate names across nested skill directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    tempDirs.push(root)
    for (const group of ['group-a', 'group-b']) {
      const skillDir = path.join(root, '.agents', 'skills', group, 'shared-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: Duplicate skill\n---\n\nInstructions\n',
        'utf8',
      )
    }

    const warnings = await validateSkillsDirectory(path.join(root, '.agents', 'skills'))
    expect(warnings.join(' ')).toContain('Skill name "shared-skill" is duplicated')
    expect(warnings.join(' ')).not.toContain('Antigravity')
  })

  it('reports unreadable skill files without aborting validation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    tempDirs.push(root)
    const skillDir = path.join(root, '.agents', 'skills', 'broken-skill')
    await mkdir(skillDir, { recursive: true })
    await symlink('missing.md', path.join(skillDir, 'SKILL.md'))

    const warnings = await validateSkillsDirectory(path.join(root, '.agents', 'skills'))

    expect(warnings.join(' ')).toContain('Skill "broken-skill" could not be read')
  })
})
