import path from 'node:path'
import TOML from '@iarna/toml'
import { ensureDir, pathExists, readTextOrEmpty, writeTextAtomic } from './fs.js'
import { getHomeDir } from './paths.js'

type CodexConfig = {
  projects?: Record<string, { trust_level?: string } & Record<string, unknown>>
} & Record<string, unknown>

export type CodexTrustState = 'trusted' | 'untrusted' | 'unreadable'

export function getCodexConfigPath(): string {
  const override = process.env.AGENTS_CODEX_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }
  return path.join(getHomeDir(), '.codex', 'config.toml')
}

/** Escape a value for a TOML basic string, used for the project path in a header. */
function escapeTomlBasicString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/** Header line Codex uses for a project entry, e.g. `[projects."/path/to/repo"]`. */
function projectHeader(projectKey: string): string {
  return `[projects."${escapeTomlBasicString(projectKey)}"]`
}

/**
 * Read the trust level of a project from the Codex global config.
 *
 * A file Codex itself cannot parse gets its own state: Codex ignores every project
 * while that is true, so reporting `trusted` there would hide the real problem.
 */
export async function getCodexTrustState(projectRoot: string): Promise<CodexTrustState> {
  const configPath = getCodexConfigPath()
  if (!(await pathExists(configPath))) return 'untrusted'

  const raw = await readTextOrEmpty(configPath)
  if (raw.trim().length === 0) return 'untrusted'

  const projectKey = path.resolve(projectRoot)

  try {
    const parsed = TOML.parse(raw) as CodexConfig
    return parsed.projects?.[projectKey]?.trust_level === 'trusted' ? 'trusted' : 'untrusted'
  } catch {
    return 'unreadable'
  }
}

/** Locate `trust_level` inside the `[projects."..."]` section without parsing the whole file. */
function findSectionTrustLevel(raw: string, projectKey: string): string | undefined {
  const lines = raw.split(/\r?\n/)
  const header = projectHeader(projectKey)
  const headerIndex = lines.findIndex((line) => line.trim() === header)
  if (headerIndex === -1) return undefined

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ''
    if (line.startsWith('[')) break
    const match = line.match(/^trust_level\s*=\s*"([^"]*)"/)
    if (match) return match[1]
  }
  return undefined
}

/**
 * Mark a project as trusted in the Codex global config.
 *
 * The file is edited in place rather than reserialized: Codex's config carries
 * comments, ordering and settings this tool knows nothing about, and a config with
 * a syntax error elsewhere must still be fixable here.
 */
export async function ensureCodexProjectTrusted(projectRoot: string): Promise<{ changed: boolean; path: string }> {
  const configPath = getCodexConfigPath()
  const projectKey = path.resolve(projectRoot)
  const raw = await readTextOrEmpty(configPath)

  if (findSectionTrustLevel(raw, projectKey) === 'trusted') {
    return { changed: false, path: configPath }
  }

  // A config Codex itself cannot read is left untouched: editing it would hide the
  // real problem, and `agents doctor` reports the parse error with its location.
  const health = await inspectCodexGlobalConfig()
  if (!health.ok) {
    throw new Error(`${configPath} is not valid TOML (${health.error ?? 'parse error'}); fix it before setting trust.`)
  }

  const header = projectHeader(projectKey)

  // TOML can record the same project as an inline table, a dotted key or with single
  // quotes. Appending a section in those cases would create a duplicate key and break
  // the file, so the entry is reported instead of rewritten.
  if (raw.trim().length > 0) {
    const parsed = TOML.parse(raw) as CodexConfig
    const knownEntry = parsed.projects?.[projectKey]
    if (knownEntry !== undefined && !raw.split(/\r?\n/).some((line) => line.trim() === header)) {
      throw new Error(
        `${configPath} already defines this project in a form this tool does not edit; set trust_level = "trusted" for ${projectKey} manually.`,
      )
    }
  }
  const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.length > 0 ? raw.split(/\r?\n/) : []
  const headerIndices = lines
    .map((line, index) => (line.trim() === header ? index : -1))
    .filter((index) => index !== -1)

  if (headerIndices.length > 1) {
    throw new Error(
      `${configPath} declares ${String(headerIndices.length)} sections for this project; fix the duplicate before setting trust.`,
    )
  }

  const headerIndex = headerIndices[0]

  if (headerIndex === undefined) {
    const prefix = raw.length === 0 || raw.endsWith(lineEnding) ? raw : `${raw}${lineEnding}`
    const separator = prefix.trim().length > 0 ? lineEnding : ''
    const block = `${separator}${header}${lineEnding}trust_level = "trusted"${lineEnding}`
    await ensureDir(path.dirname(configPath))
    await writeTextAtomic(configPath, `${prefix}${block}`)
    return { changed: true, path: configPath }
  }

  const next = [...lines]
  let replaced = false
  for (let index = headerIndex + 1; index < next.length; index += 1) {
    const raw = next[index] ?? ''
    const line = raw.trim()
    if (line.startsWith('[')) break
    if (/^trust_level\s*=/.test(line)) {
      // Replace only the value, so indentation and any trailing comment survive.
      next[index] = raw.replace(/^(\s*trust_level\s*=\s*)("[^"]*"|'[^']*'|\S+)/, '$1"trusted"')
      replaced = true
      break
    }
  }

  if (!replaced) {
    next.splice(headerIndex + 1, 0, 'trust_level = "trusted"')
  }

  await ensureDir(path.dirname(configPath))
  await writeTextAtomic(configPath, next.join(lineEnding))
  return { changed: true, path: configPath }
}

/**
 * Check whether the Codex global config can be parsed, so callers can report the
 * real reason (a duplicate key, a stray bracket) instead of a generic failure.
 */
export async function inspectCodexGlobalConfig(): Promise<{ ok: boolean; path: string; error?: string }> {
  const configPath = getCodexConfigPath()
  if (!(await pathExists(configPath))) return { ok: true, path: configPath }

  const raw = await readTextOrEmpty(configPath)
  if (raw.trim().length === 0) return { ok: true, path: configPath }

  try {
    TOML.parse(raw)
    return { ok: true, path: configPath }
  } catch (error) {
    return {
      ok: false,
      path: configPath,
      error: error instanceof Error ? error.message.split('\n')[0] : String(error)
    }
  }
}


type GrokTrustedFolders = {
  folders?: Record<string, { trusted?: boolean } & Record<string, unknown>>
} & Record<string, unknown>

export type GrokTrustState = CodexTrustState

/**
 * Grok keeps folder trust in a file of its own, not in `config.toml`.
 *
 * Until a folder is trusted, Grok ignores the project's MCP servers and the skills it
 * would otherwise read from `.agents/skills`, without reporting anything: `grok inspect`
 * simply lists none of them.
 */
export function getGrokTrustedFoldersPath(): string {
  const override = process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }
  return path.join(getHomeDir(), '.grok', 'trusted_folders.toml')
}

/** Header line Grok uses for a folder entry, e.g. `[folders."/path/to/repo"]`. */
function grokFolderHeader(folderKey: string): string {
  return `[folders."${escapeTomlBasicString(folderKey)}"]`
}

/** Read whether Grok trusts this project. */
export async function getGrokTrustState(projectRoot: string): Promise<GrokTrustState> {
  const trustPath = getGrokTrustedFoldersPath()
  if (!(await pathExists(trustPath))) return 'untrusted'

  const raw = await readTextOrEmpty(trustPath)
  if (raw.trim().length === 0) return 'untrusted'

  const folderKey = path.resolve(projectRoot)

  try {
    const parsed = TOML.parse(raw) as GrokTrustedFolders
    return parsed.folders?.[folderKey]?.trusted === true ? 'trusted' : 'untrusted'
  } catch {
    return 'unreadable'
  }
}

/**
 * Mark a project as trusted for Grok.
 *
 * Edited in place for the same reason as the Codex config: the file records when each
 * decision was made and this tool owns only the entry it adds.
 */
export async function ensureGrokProjectTrusted(projectRoot: string): Promise<{ changed: boolean; path: string }> {
  const trustPath = getGrokTrustedFoldersPath()
  const folderKey = path.resolve(projectRoot)
  const raw = await readTextOrEmpty(trustPath)

  if (raw.trim().length > 0) {
    // The duplicate check runs before parsing: TOML.parse rejects a repeated section as
    // a redefined key, which is true but says nothing about which folder to look at.
    const duplicateHeader = grokFolderHeader(folderKey)
    const duplicateCount = raw.split(/\r?\n/).filter((line) => line.trim() === duplicateHeader).length
    if (duplicateCount > 1) {
      throw new Error(
        `${trustPath} declares ${String(duplicateCount)} sections for this folder; fix the duplicate before setting trust.`,
      )
    }

    let parsed: GrokTrustedFolders
    try {
      parsed = TOML.parse(raw) as GrokTrustedFolders
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
      throw new Error(`${trustPath} is not valid TOML (${message}); fix it before setting trust.`)
    }

    // A `folders` value that is not a table of tables (an inline table, an array of
    // tables, a scalar) cannot take an appended `[folders."..."]` section: TOML would
    // see a redefined key and Grok would stop reading the file entirely.
    if (parsed.folders !== undefined && (typeof parsed.folders !== 'object' || Array.isArray(parsed.folders))) {
      throw new Error(
        `${trustPath} records folders in a form this tool does not edit; set trusted = true for ${folderKey} manually.`,
      )
    }

    if (parsed.folders?.[folderKey]?.trusted === true) {
      return { changed: false, path: trustPath }
    }

    const header = grokFolderHeader(folderKey)
    const headerIndices = raw
      .split(/\r?\n/)
      .map((line, index) => (line.trim() === header ? index : -1))
      .filter((index) => index !== -1)

    const inlineFolders = /^\s*folders\s*=/m.test(raw)
    if (inlineFolders) {
      throw new Error(
        `${trustPath} defines folders as an inline value; set trusted = true for ${folderKey} manually.`,
      )
    }

    if (parsed.folders?.[folderKey] !== undefined && headerIndices.length === 0) {
      throw new Error(
        `${trustPath} already records this folder in a form this tool does not edit; set trusted = true for ${folderKey} manually.`,
      )
    }

    const headerIndex = headerIndices[0]
    if (headerIndex !== undefined) {
      const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
      const next = raw.split(/\r?\n/)
      let replaced = false
      for (let index = headerIndex + 1; index < next.length; index += 1) {
        const line = next[index] ?? ''
        if (line.trim().startsWith('[')) break
        if (/^\s*trusted\s*=/.test(line)) {
          next[index] = line.replace(/^(\s*trusted\s*=\s*)(\S+)/, '$1true')
          replaced = true
          break
        }
      }
      if (!replaced) {
        next.splice(headerIndex + 1, 0, 'trusted = true')
      }
      await ensureDir(path.dirname(trustPath))
      await writeTextAtomic(trustPath, next.join(lineEnding))
      return { changed: true, path: trustPath }
    }
  }

  const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
  const prefix = raw.length === 0 || raw.endsWith(lineEnding) ? raw : `${raw}${lineEnding}`
  const separator = prefix.trim().length > 0 ? lineEnding : ''
  const decidedAt = Math.floor(Date.now() / 1000)
  const block =
    `${separator}${grokFolderHeader(folderKey)}${lineEnding}`
    + `trusted = true${lineEnding}`
    + `decided_at = ${String(decidedAt)}${lineEnding}`
  await ensureDir(path.dirname(trustPath))
  await writeTextAtomic(trustPath, `${prefix}${block}`)
  return { changed: true, path: trustPath }
}
