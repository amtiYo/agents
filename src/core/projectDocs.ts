import path from 'node:path'
import { pathExists, readTextOrEmpty, writeTextAtomic } from './fs.js'

const START_MARKER = '<!-- agents:project-docs:start -->'
const END_MARKER = '<!-- agents:project-docs:end -->'

const README_RELATIVE = 'README.md'
const CONTRIBUTING_RELATIVE = 'CONTRIBUTING.md'

export interface SyncProjectDocsResult {
  changed: string[]
  skipped: string[]
}

export function buildReadmeAgentsBlock(): string {
  return [
    START_MARKER,
    '## Using agents in this repository',
    '',
    'This repository uses `@agents-dev/cli` to keep MCP servers, skills, and instructions aligned across AI tools.',
    '',
    '### Quick commands',
    '',
    '```bash',
    'agents status',
    'agents mcp add <url-or-name>',
    'agents mcp test --runtime',
    'agents sync',
    'agents sync --check',
    '```',
    '',
    '### One MCP setup for all tools',
    '',
    'Add a server once in `.agents/agents.json`, then run `agents sync` to materialize it for enabled integrations.',
    '',
    '### References',
    '',
    '- MCP Protocol Docs: https://modelcontextprotocol.io',
    '- MCP servers catalog: https://mcpservers.org',
    '- Project examples: `docs/EXAMPLES.md`',
    END_MARKER
  ].join('\n')
}

export function buildContributingAgentsBlock(): string {
  return [
    START_MARKER,
    '## agents workflow note',
    '',
    'This repository is managed with `@agents-dev/cli`.',
    '',
    'Before opening a PR for MCP/skills/instructions changes, run:',
    '',
    '```bash',
    'agents sync --check',
    'agents doctor',
    '```',
    END_MARKER
  ].join('\n')
}

export function upsertManagedAgentsDocsSection(content: string, block: string): string {
  const normalized = ensureTrailingNewline(content)
  const existingStart = normalized.indexOf(START_MARKER)
  const existingEnd = normalized.indexOf(END_MARKER)
  const blockWithNewline = ensureTrailingNewline(block)

  if (existingStart >= 0 && existingEnd >= 0 && existingEnd > existingStart) {
    const afterEnd = existingEnd + END_MARKER.length
    const before = normalized.slice(0, existingStart).replace(/\s*$/, '')
    const after = normalized.slice(afterEnd).replace(/^\s*/, '')
    const chunks = [before, blockWithNewline.trimEnd(), after].filter((chunk) => chunk.length > 0)
    return `${chunks.join('\n\n').trimEnd()}\n`
  }

  const base = normalized.trimEnd()
  if (base.length === 0) {
    return blockWithNewline
  }
  return `${base}\n\n${blockWithNewline}`
}

export async function syncProjectDocsSections(args: {
  projectRoot: string
  includeContributing: boolean
}): Promise<SyncProjectDocsResult> {
  const { projectRoot, includeContributing } = args
  const changed: string[] = []
  const skipped: string[] = []

  const readmePath = path.join(projectRoot, README_RELATIVE)
  const hasReadme = await pathExists(readmePath)
  if (hasReadme) {
    const before = await readTextOrEmpty(readmePath)
    const after = upsertManagedAgentsDocsSection(before, buildReadmeAgentsBlock())
    if (after !== ensureTrailingNewline(before)) {
      await writeTextAtomic(readmePath, after)
      changed.push(README_RELATIVE)
    }
  } else {
    skipped.push(README_RELATIVE)
  }

  if (includeContributing) {
    const contributingPath = path.join(projectRoot, CONTRIBUTING_RELATIVE)
    const hasContributing = await pathExists(contributingPath)
    if (hasContributing) {
      const before = await readTextOrEmpty(contributingPath)
      const after = upsertManagedAgentsDocsSection(before, buildContributingAgentsBlock())
      if (after !== ensureTrailingNewline(before)) {
        await writeTextAtomic(contributingPath, after)
        changed.push(CONTRIBUTING_RELATIVE)
      }
    } else {
      skipped.push(CONTRIBUTING_RELATIVE)
    }
  }

  return { changed, skipped }
}

function ensureTrailingNewline(text: string): string {
  if (text.length === 0) return ''
  return text.endsWith('\n') ? text : `${text}\n`
}
