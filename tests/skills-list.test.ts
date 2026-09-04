import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runSkillsList } from '../src/commands/skills-list.js'
import { runInit } from '../src/commands/init.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('agents skills list command', () => {
  it('lists discovered skills in JSON mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-list-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    const skillDirA = path.join(projectRoot, '.agents', 'skills', 'review-code')
    await mkdir(skillDirA, { recursive: true })
    await writeFile(
      path.join(skillDirA, 'SKILL.md'),
      '---\nname: review-code\ndescription: Review pull requests and code changes\n---\nWorkflow\n',
      'utf8'
    )

    let output = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => {
      output += String(chunk)
      return true
    }

    try {
      await runSkillsList({ projectRoot, json: true })
    } finally {
      process.stdout.write = origWrite
    }

    const parsed = JSON.parse(output) as {
      count: number
      skills: Array<{ name: string; path: string; description: string }>
    }

    expect(parsed.count).toBeGreaterThanOrEqual(1)
    const reviewSkill = parsed.skills.find((s) => s.name === 'review-code')
    expect(reviewSkill).toBeDefined()
    expect(reviewSkill?.description).toBe('Review pull requests and code changes')
    expect(reviewSkill?.path).toBe('review-code')
  })

  it('handles empty skills directory gracefully in human-readable mode', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-skills-empty-'))
    tempDirs.push(projectRoot)

    await runInit({ projectRoot, force: true })

    // Empty skills dir
    const skillsDir = path.join(projectRoot, '.agents', 'skills')
    await rm(skillsDir, { recursive: true, force: true })
    await mkdir(skillsDir, { recursive: true })

    let output = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => {
      output += String(chunk)
      return true
    }

    try {
      await runSkillsList({ projectRoot, json: false })
    } finally {
      process.stdout.write = origWrite
    }

    expect(output).toContain('Skills')
    expect(output).toContain('No skills configured')
  })
})
