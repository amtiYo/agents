import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import type { IntegrationName } from '../src/types.js'
import { pathExists } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function setupProject(enabled: IntegrationName[]): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-rules-sync-'))
  tempDirs.push(projectRoot)
  await runInit({ projectRoot, force: true })
  const config = await loadAgentsConfig(projectRoot)
  config.integrations.enabled = enabled
  await saveAgentsConfig(projectRoot, config)
  return projectRoot
}

async function writeRule(projectRoot: string, topic: string, content: string): Promise<void> {
  const rulesDir = path.join(projectRoot, '.agents', 'rules')
  await mkdir(rulesDir, { recursive: true })
  await writeFile(path.join(rulesDir, `${topic}.md`), content, 'utf8')
}

describe('rules sync', () => {
  it('renders a glob-scoped rule into each enabled tool format', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['cursor', 'claude', 'windsurf', 'copilot_vscode'])
    await writeRule(
      projectRoot,
      'api',
      '---\nglobs: ["apps/api/**/*.ts"]\ndescription: API rules\n---\n\nValidate all inputs.\n'
    )

    const check = await performSync({ projectRoot, check: true, verbose: false })
    expect(check.changed).toContain('.cursor/rules/api.mdc')

    await performSync({ projectRoot, check: false, verbose: false })

    const cursor = await readFile(path.join(projectRoot, '.cursor', 'rules', 'api.mdc'), 'utf8')
    expect(cursor).toContain('globs: apps/api/**/*.ts')
    expect(cursor).toContain('alwaysApply: false')
    expect(cursor).toContain('Validate all inputs.')

    const claude = await readFile(path.join(projectRoot, '.claude', 'rules', 'api.md'), 'utf8')
    expect(claude).toContain('paths: ["apps/api/**/*.ts"]')
    expect(claude).toContain('Validate all inputs.')

    const windsurf = await readFile(path.join(projectRoot, '.windsurf', 'rules', 'api.md'), 'utf8')
    expect(windsurf).toContain('trigger: glob')
    expect(windsurf).toContain('globs: apps/api/**/*.ts')

    const copilot = await readFile(
      path.join(projectRoot, '.github', 'instructions', 'api.instructions.md'),
      'utf8'
    )
    expect(copilot).toContain('applyTo: "apps/api/**/*.ts"')
  })

  it('maps an always-on rule per tool and skips disabled tools', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['claude', 'windsurf'])
    await writeRule(
      projectRoot,
      'house',
      '---\nalwaysApply: true\ndescription: house rules\n---\n\nBe consistent.\n'
    )

    await performSync({ projectRoot, check: false, verbose: false })

    const claude = await readFile(path.join(projectRoot, '.claude', 'rules', 'house.md'), 'utf8')
    expect(claude).not.toContain('paths:')
    expect(claude).toContain('Be consistent.')

    const windsurf = await readFile(path.join(projectRoot, '.windsurf', 'rules', 'house.md'), 'utf8')
    expect(windsurf).toContain('trigger: always_on')

    // cursor + copilot are disabled -> no files generated
    expect(await pathExists(path.join(projectRoot, '.cursor', 'rules', 'house.mdc'))).toBe(false)
    expect(
      await pathExists(path.join(projectRoot, '.github', 'instructions', 'house.instructions.md'))
    ).toBe(false)
  })

  it('parses block-list globs, brace globs, and colon descriptions correctly', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['cursor', 'claude'])
    await writeRule(
      projectRoot,
      'multi',
      [
        '---',
        'description: "API: validation rules"',
        'globs:',
        '  - "apps/api/**/*.ts"',
        '  - "src/{a,b}/**"',
        '---',
        '',
        'Body.'
      ].join('\n') + '\n'
    )

    await performSync({ projectRoot, check: false, verbose: false })

    const claude = await readFile(path.join(projectRoot, '.claude', 'rules', 'multi.md'), 'utf8')
    // Block-list globs are captured (not dropped) and the brace glob stays intact.
    expect(claude).toContain('paths: ["apps/api/**/*.ts", "src/{a,b}/**"]')

    const cursor = await readFile(path.join(projectRoot, '.cursor', 'rules', 'multi.mdc'), 'utf8')
    expect(cursor).toContain('src/{a,b}/**')
    // Description with a colon is quoted so it stays valid frontmatter.
    expect(cursor).toContain('description: "API: validation rules"')
  })

  it('treats a rule with no frontmatter as an always-loaded Claude rule', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['claude'])
    await writeRule(projectRoot, 'plain', 'Just guidance, no frontmatter.\n')

    await performSync({ projectRoot, check: false, verbose: false })

    const claude = await readFile(path.join(projectRoot, '.claude', 'rules', 'plain.md'), 'utf8')
    expect(claude).not.toContain('---')
    expect(claude).toContain('Just guidance, no frontmatter.')
  })

  it('warns and skips when an unmanaged rule file already exists', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['cursor'])

    const cursorRulesDir = path.join(projectRoot, '.cursor', 'rules')
    await mkdir(cursorRulesDir, { recursive: true })
    await writeFile(path.join(cursorRulesDir, 'existing.mdc'), 'Unmanaged content.\n', 'utf8')

    await writeRule(projectRoot, 'existing', '---\nalwaysApply: true\ndescription: x\n---\n\nNew rule.\n')

    const result = await performSync({ projectRoot, check: false, verbose: false })

    expect(result.warnings.some((w) => w.includes('not managed by agents'))).toBe(true)
    // The pre-existing file is preserved, not overwritten.
    const content = await readFile(path.join(cursorRulesDir, 'existing.mdc'), 'utf8')
    expect(content).toBe('Unmanaged content.\n')
  })

  it('removes stale rule files when the source rule is deleted', { timeout: 25000 }, async () => {
    const projectRoot = await setupProject(['cursor', 'claude'])
    await writeRule(
      projectRoot,
      'temp',
      '---\nalwaysApply: true\ndescription: temporary\n---\n\nTemporary rule.\n'
    )

    await performSync({ projectRoot, check: false, verbose: false })
    expect(await pathExists(path.join(projectRoot, '.cursor', 'rules', 'temp.mdc'))).toBe(true)
    expect(await pathExists(path.join(projectRoot, '.claude', 'rules', 'temp.md'))).toBe(true)

    await rm(path.join(projectRoot, '.agents', 'rules', 'temp.md'))
    await performSync({ projectRoot, check: false, verbose: false })

    expect(await pathExists(path.join(projectRoot, '.cursor', 'rules', 'temp.mdc'))).toBe(false)
    expect(await pathExists(path.join(projectRoot, '.claude', 'rules', 'temp.md'))).toBe(false)
  })
})
