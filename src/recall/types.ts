/** Providers whose local transcripts recall can index. */
export type RecallProvider = 'claude' | 'codex' | 'cursor' | 'grok' | 'gemini' | 'aside' | 'opencode'

/** Speech side of a turn. Tool dumps are never a role. */
export type RecallRole = 'user' | 'assistant'

export const RECALL_PROVIDERS: readonly RecallProvider[] = [
  'claude',
  'codex',
  'cursor',
  'grok',
  'gemini',
  'aside',
  'opencode'
]

/** How a turn is located in its original store so `get` can re-read it. */
export type RecallSourceKind = 'jsonl' | 'json' | 'sqlite'

export interface RecallSearchOptions {
  /** Absolute or relative project path. Defaults to `cwd`. Ignored when `all` is true. */
  project?: string
  /** Search every project, not only the current one. */
  all?: boolean
  /** Maximum hits to return. Default 5, cap 50. */
  limit?: number
  /** Override the index sqlite path. */
  indexPath?: string
  /** Used to resolve a relative `project` and the default project filter. */
  cwd?: string
}

export interface RecallHit {
  provider: RecallProvider
  sessionId: string
  turn: number
  role: RecallRole
  timestamp: string | null
  project: string | null
  quote: string
  tools: string[]
  paths: string[]
}

export interface RecallTurn extends RecallHit {
  /** Full speech from the original file (redacted). Falls back to the indexed quote. */
  text: string
  sourcePath: string
  sourceMissing: boolean
}

export interface RecallGetOptions {
  indexPath?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

export interface RecallDoctorStats {
  indexPath: string
  files: number
  turns: number
  redacted: number
  skippedSubagents: number
  providers: Record<RecallProvider, { files: number; turns: number }>
  wal: boolean
}

export interface RecallDoctorOptions {
  indexPath?: string
}

export interface RecallIngestOptions {
  /** Override the index sqlite path. Tests must set this. */
  indexPath?: string
  /** Home directory used to discover provider stores. */
  homeDir?: string
  /** Environment used for provider path overrides. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Restrict ingest to these providers. Default: all v1 adapters. */
  providers?: RecallProvider[]
  /** Rebuild files even when mtime+size are unchanged. */
  force?: boolean
}

export interface RecallIngestError {
  path: string
  message: string
}

export interface RecallIngestResult {
  filesSeen: number
  filesIndexed: number
  filesUnchanged: number
  filesRemoved: number
  turnsIndexed: number
  redacted: number
  skippedSubagents: number
  errors: RecallIngestError[]
}

export interface RecallParsedTurn {
  sessionId: string
  role: RecallRole
  timestampMs: number | null
  project: string | null
  text: string
  tools: string[]
  paths: string[]
  sourceKind: RecallSourceKind
  sourceLine: number | null
  sourceKey: string | null
}

export interface RecallParsedFile {
  provider: RecallProvider
  path: string
  skipped: 'subagent' | 'empty' | null
  turns: RecallParsedTurn[]
}

export interface RecallAdapter {
  id: RecallProvider
  discover(homeDir: string, env: NodeJS.ProcessEnv): Promise<string[]>
  parse(filePath: string, homeDir: string, env: NodeJS.ProcessEnv): Promise<RecallParsedFile>
}

export interface RecallFileRow {
  id: number
  path: string
  provider: RecallProvider
  mtimeMs: number
  size: number
  turnCount: number
  redactedCount: number
  skipped: string | null
}

/** Pointer from a shelf fact back to one indexed speech turn. */
export interface RecallCitation {
  provider: RecallProvider
  date: string | null
  project: string | null
  sessionId: string
  turn: number
  quote: string
}

/** One cited fact. Omit the fact entirely when `citations` would be empty. */
export interface RecallShelfItem {
  text: string
  citations: RecallCitation[]
}

/** Person-level facts: languages, timezone, git identity, how to address them. */
export interface RecallWho {
  languages: RecallShelfItem[]
  timezone: RecallShelfItem | null
  gitUser: RecallShelfItem | null
  addressAs: RecallShelfItem | null
}

/** A cwd cluster the person actually works in. */
export interface RecallWorkCluster {
  name: string
  path: string
  sessions: number
  turns: number
  lastDate: string | null
  citations: RecallCitation[]
}

/** A settled decision with the source turn's date and provider. */
export interface RecallDecision {
  text: string
  date: string | null
  provider: RecallProvider
  citations: RecallCitation[]
}

/** An unfinished thread in the current repo. */
export interface RecallOpenThread {
  text: string
  sessionId: string
  date: string | null
  provider: RecallProvider
  citations: RecallCitation[]
}

/** Compiled person / project card. Every nested item carries citations. */
export interface RecallShelves {
  who: RecallWho
  work: RecallWorkCluster[]
  stack: RecallShelfItem[]
  decisions: RecallDecision[]
  open: RecallOpenThread[]
}

/** `project()` adds the resolved cwd path on top of the shared shelf shape. */
export interface RecallProjectShelves extends RecallShelves {
  project: string
}

export interface RecallShelfOptions {
  /** Override the index sqlite path. Tests must set this. */
  indexPath?: string
  /** Home directory used to read git identity (`~/.gitconfig`). */
  homeDir?: string
  /** Environment for `TZ`, `GIT_AUTHOR_*`, and git config paths. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Used by `project()` to resolve a relative `project` and the default cwd scope. */
  cwd?: string
  /** Absolute or relative project path. `project()` defaults to `cwd`. Ignored by `about()`. */
  project?: string
}
