import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateSkillsDirectory } from '../src/core/skillsValidation.js'

describe('skills validation', () => {
  it('accepts valid skill structure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    try {
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports invalid/missing frontmatter fields', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    try {
      const skillsDir = path.join(root, '.agents', 'skills')
      const skillDir = path.join(skillsDir, 'bad-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(path.join(skillDir, 'SKILL.md'), 'no frontmatter\n', 'utf8')

      const warnings = await validateSkillsDirectory(skillsDir)
      expect(warnings.join(' ')).toContain('no YAML frontmatter')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('accepts skills nested below grouping directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    try {
      const skillDir = path.join(root, '.agents', 'skills', 'group-a', 'nested-skill')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: nested-skill\ndescription: Nested skill\n---\n\nInstructions\n',
        'utf8',
      )

      const warnings = await validateSkillsDirectory(path.join(root, '.agents', 'skills'))
      expect(warnings).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports duplicate names across nested skill directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-'))
    try {
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
