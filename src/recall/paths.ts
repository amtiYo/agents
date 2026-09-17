import os from 'node:os'
import path from 'node:path'
import { isDirectory } from '../core/fs.js'
import { getHomeDir } from '../core/paths.js'

const INDEX_FILE = 'index.sqlite'

/**
 * Resolve the XDG data root (`$XDG_DATA_HOME` or `~/.local/share`).
 */
export function getXdgDataDir(homeDir = getHomeDir()): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.resolve(xdg.trim())
  }
  return path.join(path.resolve(homeDir), '.local', 'share')
}

/**
 * Directory that holds the recall index (`~/.local/share/agents/recall`).
 *
 * Override with `AGENTS_RECALL_DIR`.
 */
export function getRecallDir(homeDir = getHomeDir()): string {
  const override = process.env.AGENTS_RECALL_DIR
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  return path.join(getXdgDataDir(homeDir), 'agents', 'recall')
}

/**
 * SQLite index path (`~/.local/share/agents/recall/index.sqlite`).
 *
 * Override with `AGENTS_RECALL_INDEX`.
 */
export function getRecallIndexPath(homeDir = getHomeDir()): string {
  const override = process.env.AGENTS_RECALL_INDEX
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  return path.join(getRecallDir(homeDir), INDEX_FILE)
}

/** Split a comma-separated env path list, dropping empties. */
export function splitEnvPaths(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry))
}

export async function uniqueExistingDirs(candidates: string[]): Promise<string[]> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (await isDirectory(resolved)) out.push(resolved)
  }
  return out
}

/**
 * Claude Code project roots, matching agentsBar DATA-SOURCES.md:
 * `$CLAUDE_CONFIG_DIR` (comma-separated), `$XDG_CONFIG_HOME/claude`,
 * `~/.config/claude`, `~/.claude`, plus `~/.claude-*` siblings that contain `projects/`.
 */
export async function claudeProjectDirs(homeDir: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const projectsName = env.CLAUDE_CODE_PROJECT_DIR_NAME?.trim() || 'projects'
  const configured = splitEnvPaths(env.CLAUDE_CONFIG_DIR)
  if (configured.length > 0) {
    return uniqueExistingDirs(configured.map((dir) => (path.basename(dir) === projectsName ? dir : path.join(dir, projectsName))))
  }

  const home = path.resolve(homeDir)
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const xdgClaude = path.join(xdg ? path.resolve(xdg) : path.join(home, '.config'), 'claude', projectsName)
  const candidates = [
    xdgClaude,
    path.join(home, '.config', 'claude', projectsName),
    path.join(home, '.claude', projectsName)
  ]

  try {
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(home, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      if (!entry.name.startsWith('.claude-')) continue
      candidates.push(path.join(home, entry.name, projectsName))
    }
  } catch {
    // Home unreadable: keep the well-known candidates.
  }

  return uniqueExistingDirs(candidates)
}

export function codexHome(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.CODEX_HOME?.trim()
  if (override) return path.resolve(override)
  return path.join(path.resolve(homeDir), '.codex')
}

export function grokHome(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.GROK_HOME?.trim()
  if (override) return path.resolve(override)
  return path.join(path.resolve(homeDir), '.grok')
}

export function geminiHome(homeDir: string, env: NodeJS.ProcessEnv): string {
  const cliHome = env.GEMINI_CLI_HOME?.trim()
  if (cliHome) return path.join(path.resolve(cliHome), '.gemini')
  const configDir = env.GEMINI_CONFIG_DIR?.trim()
  if (configDir) {
    const resolved = path.resolve(configDir)
    return path.basename(resolved) === 'tmp' ? path.dirname(resolved) : resolved
  }
  return path.join(path.resolve(homeDir), '.gemini')
}

export function asideHome(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.ASIDE_HOME?.trim()
  if (override) return path.resolve(override)
  return path.join(path.resolve(homeDir), '.aside')
}

export function opencodeDataDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.OPENCODE_DATA_DIR?.trim()
  if (override) return path.resolve(override)
  if (process.platform === 'linux') {
    const xdg = env.XDG_DATA_HOME?.trim()
    if (xdg) return path.join(path.resolve(xdg), 'opencode')
  }
  return path.join(path.resolve(homeDir), '.local', 'share', 'opencode')
}

export function cursorCliHome(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.CURSOR_CONFIG_DIR?.trim()
  if (override) return path.resolve(override)
  return path.join(path.resolve(homeDir), '.cursor')
}

export function cursorUserRoot(homeDir: string, env: NodeJS.ProcessEnv): string {
  const override = env.CURSOR_USER_DIR?.trim()
  if (override) return path.resolve(override)
  if (process.platform === 'darwin') {
    return path.join(path.resolve(homeDir), 'Library', 'Application Support', 'Cursor', 'User')
  }
  if (process.platform === 'win32') {
    const appdata = env.APPDATA?.trim()
    const root = appdata ? path.resolve(appdata) : path.join(path.resolve(homeDir), 'AppData', 'Roaming')
    return path.join(root, 'Cursor', 'User')
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  if (xdg) return path.join(path.resolve(xdg), 'Cursor', 'User')
  return path.join(path.resolve(homeDir), '.config', 'Cursor', 'User')
}

export function cursorStateDbPath(homeDir: string, env: NodeJS.ProcessEnv): string | null {
  const override = env.CURSOR_STATE_DB_PATH?.trim()
  if (override) return path.resolve(override)
  const configDir = env.CURSOR_CONFIG_DIR?.trim()
  if (configDir) {
    return path.join(path.resolve(configDir), 'User', 'globalStorage', 'state.vscdb')
  }
  return path.join(cursorUserRoot(homeDir, env), 'globalStorage', 'state.vscdb')
}

/** Normalize a project path for storage and filtering. */
export function normalizeProjectPath(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const resolved = path.resolve(trimmed)
  if (resolved.length > 1 && (resolved.endsWith('/') || resolved.endsWith('\\'))) {
    return resolved.slice(0, -1)
  }
  return resolved
}

/**
 * Whether an indexed project belongs to the active filter.
 *
 * Matches exact path or a parent/child relationship so a repo and a nested
 * worktree stay in the same bucket.
 */
export function projectMatches(stored: string | null, wanted: string): boolean {
  if (!stored) return false
  const a = normalizeProjectPath(stored)
  const b = normalizeProjectPath(wanted)
  if (!a || !b) return false
  if (a === b) return true
  const sep = path.sep
  return a.startsWith(`${b}${sep}`) || b.startsWith(`${a}${sep}`)
}

/**
 * Decode a Claude/Cursor hyphen-encoded project directory (`-Users-me-app`)
 * by walking the filesystem. Hyphenated folder names survive because the
 * literal-hyphen branch is tried when a separator split fails.
 */
export async function resolveEncodedPath(encoded: string, homeDir = getHomeDir()): Promise<string | null> {
  let base = encoded.trim()
  if (!base) return null
  if (!base.startsWith('-')) base = `-${base}`

  const trimmed = base.replace(/^-+/, '').replace(/-+$/, '')
  const parts = trimmed.split('-')
  if (parts.length === 0 || parts.length > 24 || parts[0] === '') return null

  const tryWalk = async (done: string, seg: string, index: number): Promise<string | null> => {
    if (index === parts.length) {
      const candidate = path.join(done, seg)
      return (await isDirectory(candidate)) ? candidate : null
    }
    const asDir = path.join(done, seg)
    if (await isDirectory(asDir)) {
      const nested = await tryWalk(asDir, parts[index], index + 1)
      if (nested) return nested
    }
    return tryWalk(done, `${seg}-${parts[index]}`, index + 1)
  }

  const rooted = await tryWalk(path.parse(path.resolve(homeDir)).root || path.sep, parts[0], 1)
  if (rooted) return rooted
  if (os.platform() !== 'win32') {
    return tryWalk('/', parts[0], 1)
  }
  return null
}

export function pathHasDirNamed(filePath: string, dirName: string): boolean {
  const parts = filePath.split(path.sep)
  return parts.some((part) => part.toLowerCase() === dirName.toLowerCase())
}
