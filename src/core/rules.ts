import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { ensureDir, pathExists, readJson, removeIfExists, writeJsonAtomic } from './fs.js'
import { writeManagedFile } from './managedFiles.js'
import { getProjectPaths } from './paths.js'
import type { IntegrationName } from '../types.js'

export interface RuleFrontmatter {
  description?: string
  globs?: string[]
  alwaysApply?: boolean
}

export interface RuleSource {
  topic: string
  frontmatter: RuleFrontmatter
  body: string
}

interface RulesState {
  managedNames: string[]
}

interface RenderedRule {
  topic: string
  content: string
}

/**
 * Synchronizes `.agents/rules/*.md` into per-tool rule files.
 *
 * Each source rule declares activation intent in YAML frontmatter
 * (`alwaysApply`, `globs`, `description`). On sync it is rendered into the
 * native rule format for every enabled tool that supports rule files:
 *   - Cursor   -> `.cursor/rules/<topic>.mdc`               (alwaysApply / globs / description)
 *   - Claude   -> `.claude/rules/<topic>.md`                (globs mapped to `paths`)
 *   - Windsurf -> `.windsurf/rules/<topic>.md`              (trigger / globs / description)
 *   - Copilot  -> `.github/instructions/<topic>.instructions.md` (applyTo)
 * Stale rule files from previous syncs are removed via per-tool state files.
 */
export async function syncRules(args: {
  projectRoot: string
  enabledIntegrations: IntegrationName[]
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { projectRoot, enabledIntegrations, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)
  const sources = await discoverRules(paths.agentsRulesDir)

  const cursorEnabled = enabledIntegrations.includes('cursor')
  const claudeEnabled = enabledIntegrations.includes('claude')
  const windsurfEnabled = enabledIntegrations.includes('windsurf')
  const copilotEnabled =
    enabledIntegrations.includes('copilot_vscode') || enabledIntegrations.includes('copilot_cli')

  // Warn once per source rule about activation modes a target can't express,
  // and about commas inside globs that the comma-separated tool formats can't disambiguate.
  for (const rule of sources) {
    const globs = rule.frontmatter.globs ?? []
    const descriptionOnly = globs.length === 0 && rule.frontmatter.alwaysApply !== true && Boolean(rule.frontmatter.description)
    if (descriptionOnly && (claudeEnabled || copilotEnabled)) {
      warnings.push(
        `Rule "${rule.topic}" uses description-based activation, which Claude/Copilot rules cannot express; ` +
          'they will load it as an always-on rule (Cursor and Windsurf keep the model-decision behavior).'
      )
    }
    if ((cursorEnabled || windsurfEnabled) && globs.some((glob) => glob.includes(','))) {
      warnings.push(
        `Rule "${rule.topic}" has a glob containing a comma; Cursor/Windsurf use comma-separated globs and may misread it.`
      )
    }
  }

  await syncToolRules({
    enabled: cursorEnabled,
    targetDir: paths.cursorRulesDir,
    suffix: 'mdc',
    statePath: paths.generatedCursorRulesState,
    rules: cursorEnabled ? sources.map((rule) => ({ topic: rule.topic, content: renderCursorRule(rule) })) : [],
    projectRoot,
    check,
    changed,
    warnings
  })

  await syncToolRules({
    enabled: claudeEnabled,
    targetDir: paths.claudeRulesDir,
    suffix: 'md',
    statePath: paths.generatedClaudeRulesState,
    rules: claudeEnabled ? sources.map((rule) => ({ topic: rule.topic, content: renderClaudeRule(rule) })) : [],
    projectRoot,
    check,
    changed,
    warnings
  })

  await syncToolRules({
    enabled: windsurfEnabled,
    targetDir: paths.windsurfRulesDir,
    suffix: 'md',
    statePath: paths.generatedWindsurfRulesState,
    rules: windsurfEnabled ? sources.map((rule) => ({ topic: rule.topic, content: renderWindsurfRule(rule, warnings) })) : [],
    projectRoot,
    check,
    changed,
    warnings
  })

  await syncToolRules({
    enabled: copilotEnabled,
    targetDir: paths.copilotInstructionsDir,
    suffix: 'instructions.md',
    statePath: paths.generatedCopilotRulesState,
    rules: copilotEnabled ? sources.map((rule) => ({ topic: rule.topic, content: renderCopilotRule(rule) })) : [],
    projectRoot,
    check,
    changed,
    warnings
  })
}

async function discoverRules(rulesDir: string): Promise<RuleSource[]> {
  if (!(await pathExists(rulesDir))) return []
  const entries = await readdir(rulesDir, { withFileTypes: true })
  const rules: RuleSource[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith('.') || !entry.name.endsWith('.md')) continue
    const topic = entry.name.slice(0, -'.md'.length)
    if (!topic) continue
    const raw = await readFile(path.join(rulesDir, entry.name), 'utf8')
    rules.push({ topic, ...parseRuleFile(raw) })
  }

  rules.sort((a, b) => a.topic.localeCompare(b.topic))
  return rules
}

async function syncToolRules(args: {
  enabled: boolean
  targetDir: string
  suffix: string
  statePath: string
  rules: RenderedRule[]
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { enabled, targetDir, suffix, statePath, rules, projectRoot, check, changed, warnings } = args
  const previous = await readRulesState(statePath)
  const desired = enabled ? rules.map((rule) => rule.topic) : []

  // Feature unused for this tool: nothing tracked, nothing to write.
  if (previous.length === 0 && desired.length === 0) return

  const toRemove = previous.filter((topic) => !desired.includes(topic))
  for (const topic of toRemove) {
    const file = path.join(targetDir, `${topic}.${suffix}`)
    if (!(await pathExists(file))) continue
    changed.push(path.relative(projectRoot, file) || file)
    if (!check) await removeIfExists(file)
  }

  if (enabled && rules.length > 0 && !check) {
    await ensureDir(targetDir)
  }

  const managed: string[] = []
  for (const rule of rules) {
    const file = path.join(targetDir, `${rule.topic}.${suffix}`)
    // Never clobber a pre-existing rule file we did not create (parity with skills bridge).
    if (!previous.includes(rule.topic) && (await pathExists(file))) {
      warnings.push(
        `Found existing ${path.relative(projectRoot, file) || file} not managed by agents; skipping to avoid overwriting it.`
      )
      continue
    }
    await writeManagedFile({ absolutePath: file, content: rule.content, projectRoot, check, changed })
    managed.push(rule.topic)
  }

  // State is intentionally not written in check mode (dry run must not mutate).
  if (!sameNames(previous, managed)) {
    await writeRulesState(statePath, managed, check)
  }
}

function renderCursorRule(rule: RuleSource): string {
  const { description, globs, alwaysApply } = rule.frontmatter
  const header = [
    '---',
    `description: ${description ? JSON.stringify(description) : ''}`,
    `globs: ${(globs ?? []).join(',')}`,
    `alwaysApply: ${alwaysApply === true}`,
    '---'
  ].join('\n')
  return `${header}\n\n${rule.body.trimEnd()}\n`
}

// Claude Code reads `.claude/rules/<name>.md`; a `paths:` glob array makes the rule
// load only when matching files are in context, and a file with no `paths` is always
// loaded. See https://code.claude.com/docs/en/memory.md (path-specific rules).
function renderClaudeRule(rule: RuleSource): string {
  const globs = rule.frontmatter.globs ?? []
  if (globs.length > 0) {
    const list = globs.map((glob) => JSON.stringify(glob)).join(', ')
    return `---\npaths: [${list}]\n---\n\n${rule.body.trimEnd()}\n`
  }
  // No globs -> always-loaded Claude rule (no frontmatter needed).
  return `${rule.body.trimEnd()}\n`
}

const WINDSURF_CHAR_LIMIT = 6000

function renderWindsurfRule(rule: RuleSource, warnings: string[]): string {
  const { description, globs, alwaysApply } = rule.frontmatter
  const header = ['---']

  if (globs && globs.length > 0) {
    header.push('trigger: glob')
    header.push(`globs: ${globs.join(',')}`)
  } else if (alwaysApply === true) {
    header.push('trigger: always_on')
  } else if (description) {
    header.push('trigger: model_decision')
  } else {
    header.push('trigger: always_on')
  }

  // Windsurf requires a description on every rule; fall back to the topic name.
  header.push(`description: ${JSON.stringify(description ?? rule.topic)}`)
  header.push('---')

  const content = `${header.join('\n')}\n\n${rule.body.trimEnd()}\n`
  if (content.length > WINDSURF_CHAR_LIMIT) {
    warnings.push(
      `Rule "${rule.topic}" is ${content.length} chars, over Windsurf's ${WINDSURF_CHAR_LIMIT}-char per-rule limit; Windsurf may ignore the overflow.`
    )
  }
  return content
}

function renderCopilotRule(rule: RuleSource): string {
  const { description } = rule.frontmatter
  const globs = rule.frontmatter.globs ?? []
  const header = ['---', `applyTo: ${JSON.stringify(globs.length > 0 ? globs.join(',') : '**')}`]
  if (description) {
    header.push(`description: ${JSON.stringify(description)}`)
  }
  header.push('---')
  return `${header.join('\n')}\n\n${rule.body.trimEnd()}\n`
}

function parseRuleFile(raw: string): { frontmatter: RuleFrontmatter; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u)
  const frontmatter: RuleFrontmatter = {}
  if (!match) {
    return { frontmatter, body: raw.replace(/^\n+/, '') }
  }

  const body = raw.slice(match[0].length).replace(/^\n+/, '')
  const lines = (match[1] ?? '').split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()

    if (key === 'description') {
      frontmatter.description = stripQuotes(value)
    } else if (key === 'alwaysApply') {
      frontmatter.alwaysApply = value === 'true'
    } else if (key === 'globs') {
      if (value) {
        frontmatter.globs = parseInlineList(value)
      } else {
        // YAML block list: collect the following indented "- item" lines.
        const items: string[] = []
        let j = i + 1
        while (j < lines.length && /^\s*-\s+/u.test(lines[j])) {
          items.push(stripQuotes(lines[j].replace(/^\s*-\s+/u, '').trim()))
          j += 1
        }
        frontmatter.globs = items.filter(Boolean)
        i = j - 1
      }
    }
  }
  return { frontmatter, body }
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean)
      }
    } catch {
      // Not strict JSON (e.g. single quotes) — fall back to manual parsing.
    }
    return splitTopLevel(trimmed.replace(/^\[|\]$/gu, '')).map(stripQuotes).filter(Boolean)
  }
  return splitTopLevel(trimmed).map(stripQuotes).filter(Boolean)
}

// Split on commas that are not inside brace/bracket groups, so brace-expansion
// globs like `src/{a,b}/**` stay intact.
function splitTopLevel(input: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth = Math.max(0, depth - 1)

    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/gu, '')
}

async function readRulesState(statePath: string): Promise<string[]> {
  if (!(await pathExists(statePath))) return []
  try {
    const parsed = await readJson<RulesState>(statePath)
    return Array.isArray(parsed.managedNames)
      ? parsed.managedNames.filter((name): name is string => typeof name === 'string')
      : []
  } catch {
    return []
  }
}

async function writeRulesState(statePath: string, names: string[], check: boolean): Promise<void> {
  if (check) return
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    managedNames: [...new Set(names)].sort((a, b) => a.localeCompare(b))
  })
}

function sameNames(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x.localeCompare(y))
  const sortedB = [...b].sort((x, y) => x.localeCompare(y))
  return sortedA.every((value, index) => value === sortedB[index])
}
