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
})
