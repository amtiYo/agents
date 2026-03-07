import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { SyncMode } from '../types.js'
import { pathExists, removeIfExists, writeTextAtomic } from './fs.js'

const BASE_MANAGED_ENTRIES = ['.agents/local.json', '.agents/generated/']
const SOURCE_ONLY_ENTRIES = [
  'CLAUDE.md',
  '.codex/',
  '.gemini/',
  '.vscode/mcp.json',
  '.claude/skills',
  '.cursor/',
  '.antigravity/',
  '.windsurf/',
  '.opencode/',
  'opencode.json'
]

export async function ensureProjectGitignore(projectRoot: string, syncMode: SyncMode): Promise<boolean> {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const exists = await pathExists(gitignorePath)
  const content = exists ? await readFile(gitignorePath, 'utf8') : ''
  const lines = content.split(/\r?\n/).filter(Boolean)
  const required =
    syncMode === 'source-only' ? [...BASE_MANAGED_ENTRIES, ...SOURCE_ONLY_ENTRIES] : [...BASE_MANAGED_ENTRIES]
  const shouldRemoveSourceOnly = syncMode === 'commit-generated'
  const managedSourceOnly = new Set(SOURCE_ONLY_ENTRIES)

  const nextLines: string[] = []
  let changed = false

  for (const line of lines) {
    if (shouldRemoveSourceOnly && managedSourceOnly.has(normalizeManagedEntry(line))) {
      changed = true
      continue
    }
    nextLines.push(line)
  }

  for (const entry of required) {
    if (nextLines.some((line) => normalizeManagedEntry(line) === entry)) continue
    nextLines.push(entry)
    changed = true
  }

  if (!changed) return false
  await writeTextAtomic(gitignorePath, `${nextLines.join('\n')}\n`)
  return true
}

export async function cleanupManagedGitignore(projectRoot: string): Promise<boolean> {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  if (!(await pathExists(gitignorePath))) return false

  const content = await readFile(gitignorePath, 'utf8')
  const lines = content.split(/\r?\n/)

  const managed = new Set([...BASE_MANAGED_ENTRIES, ...SOURCE_ONLY_ENTRIES])
  const filtered = lines.filter((line) => !managed.has(normalizeManagedEntry(line)))

  if (filtered.join('\n') === lines.join('\n')) {
    return false
  }

  const normalized = filtered.filter((line, idx, arr) => {
    if (idx === arr.length - 1 && line === '') return false
    return true
  })

  if (normalized.length === 0) {
    await removeIfExists(gitignorePath)
    return true
  }

  await writeTextAtomic(gitignorePath, `${normalized.join('\n')}\n`)
  return true
}

function normalizeManagedEntry(line: string): string {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return trimmed
  return trimmed.replace(/^\/+/, '')
}
