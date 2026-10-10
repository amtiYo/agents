import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { getHomeDir } from '../core/paths.js'
import { pathExists } from '../core/fs.js'
import { getRecallIndexPath, normalizeProjectPath, projectMatches } from './paths.js'
import { isoFromMs } from './speech.js'
import { openRecallDatabase, recallSqliteSupported, sqlNumber, sqlString } from './sqlite.js'
import { RECALL_PROVIDERS } from './types.js'
import type {
  RecallCitation,
  RecallDecision,
  RecallOpenThread,
  RecallProjectShelves,
  RecallProvider,
  RecallRole,
  RecallShelfItem,
  RecallShelfOptions,
  RecallShelves,
  RecallWho,
  RecallWorkCluster
} from './types.js'

const SAMPLE_TURNS = 5_000
const MAX_WORK = 12
const MAX_STACK = 12
const MAX_HABITS = 6
const MAX_DECISIONS = 12
const MAX_OPEN = 8
const MAX_CITATIONS = 3
const STACK_MIN_SESSIONS = 2
const OPEN_MAX_AGE_MS = 45 * 86_400_000
const MIN_LANGUAGE_LETTERS = 24
const MIN_LANGUAGE_TURNS = 2

const STACK_TERMS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'TypeScript', pattern: /\bTypeScript\b|\.tsx\b/i },
  { label: 'JavaScript', pattern: /\bJavaScript\b|\.jsx\b/i },
  { label: 'Node.js', pattern: /\bNode\.js\b|\bnodejs\b/i },
  { label: 'Next.js', pattern: /\bNext\.js\b/i },
  { label: 'PostgreSQL', pattern: /\bPostgreSQL\b|\bPostgres\b/i },
  { label: 'SQLite', pattern: /\bSQLite\b/i },
  { label: 'FTS5', pattern: /\bFTS5\b/i },
  { label: 'Vitest', pattern: /\bVitest\b/i },
  { label: 'Playwright', pattern: /\bPlaywright\b/i },
  { label: 'Kubernetes', pattern: /\bKubernetes\b|\bk8s\b/i },
  { label: 'Terraform', pattern: /\bTerraform\b/i },
  { label: 'GraphQL', pattern: /\bGraphQL\b/i },
  { label: 'FastAPI', pattern: /\bFastAPI\b/i },
  { label: 'Tailwind', pattern: /\bTailwind\b/i },
  { label: 'Docker', pattern: /\bDocker\b/i },
  { label: 'Python', pattern: /\bPython\b/i },
  { label: 'Prisma', pattern: /\bPrisma\b/i },
  { label: 'Drizzle', pattern: /\bDrizzle\b/i },
  { label: 'Redis', pattern: /\bRedis\b/i },
  { label: 'React', pattern: /\bReact\b/i },
  { label: 'Rust', pattern: /\bRust\b/i },
  { label: 'MCP', pattern: /\bMCP\b/ },
  { label: 'Vite', pattern: /\bVite\b/ },
  { label: 'Bun', pattern: /\bBun\b/ },
  { label: 'pnpm', pattern: /\bpnpm\b/i },
  { label: 'Jest', pattern: /\bJest\b/ },
  { label: 'Vue', pattern: /\bVue(?:\.js)?\b/i },
  { label: 'Svelte', pattern: /\bSvelte\b/i },
  { label: 'Django', pattern: /\bDjango\b/i },
  { label: 'Flask', pattern: /\bFlask\b/i },
  { label: 'Express', pattern: /\bExpress\b/ },
  { label: 'Fastify', pattern: /\bFastify\b/i },
  { label: 'MySQL', pattern: /\bMySQL\b/i },
  { label: 'Telegram', pattern: /\bTelegram\b/i }
]

const DECISION_RES: RegExp[] = [
  /\bwe decided(?:\s+that|\s+to)?\b[^.!?\n]{8,180}/i,
  /\bdecided to\b[^.!?\n]{8,180}/i,
  /\bsettled on\b[^.!?\n]{8,180}/i,
  /\bgoing with\b[^.!?\n]{8,180}/i,
  /\blet's (?:go with|use)\b[^.!?\n]{8,180}/i,
  /\bwe'll (?:go with|use)\b[^.!?\n]{8,180}/i,
  /\bagreed (?:to|on)\b[^.!?\n]{8,180}/i,
  /(?<![\p{L}\p{N}_])мы решили(?:\s+что)?(?![\p{L}\p{N}_])[^.!?\n]{8,180}/iu,
  /(?<![\p{L}\p{N}_])решили(?:\s+что)?(?![\p{L}\p{N}_])[^.!?\n]{8,180}/iu,
  /(?<![\p{L}\p{N}_])остановились на(?![\p{L}\p{N}_])[^.!?\n]{8,180}/iu,
  /(?<![\p{L}\p{N}_])договорились(?:\s+что)?(?![\p{L}\p{N}_])[^.!?\n]{8,180}/iu
]

const ASSISTANT_DECISION_RE = /\bwe decided\b|(?<![\p{L}\p{N}_])мы решили(?![\p{L}\p{N}_])|\bas (?:we|you) decided\b|\byou decided\b/iu

const DECISION_FTS =
  '"we decided" OR "decided to" OR "settled on" OR "going with" OR "go with" OR agreed OR решили OR остановились OR договорились'

const CLOSED_THREAD_RE =
  /^(thanks|thank you|thx|tysm|ty|lgtm|done|ship it|perfect|great|ok|okay|cool|cheers|спасибо|благодар[а-я]*|готово|отлично|супер)[\s!.]*$/iu

const OPEN_ASSISTANT_RE =
  /\?|TODO\b|next step|want me to|should I|I can also|продолж|что дальше|на чём мы/i

const HABIT_RES: RegExp[] = [
  /\b(?:I|we)\s+(?:always|usually|prefer|never)\s+[^.!?\n]{8,100}/gi,
  /(?:я|мы)\s+(?:всегда|обычно|предпочитаю|предпочитаем|никогда не)\s+[^.!?\n]{8,100}/gi
]

const ADDRESS_RES: RegExp[] = [
  /\b(?:call me|my name is)\s+([A-Z][a-zA-Z]{1,24}(?:\s+[A-Z][a-zA-Z]{1,24})?)/,
  /меня зовут\s+([A-ZА-ЯЁ][a-zа-яё]{1,24}(?:\s+[A-ZА-ЯЁа-яё]{1,24})?)/i,
  /обращайся(?:\s+ко мне)?(?:\s+как)?\s+([A-ZА-ЯЁ][a-zа-яё]{1,24})/i
]

const TZ_IN_TEXT_RE =
  /\b(?:UTC|GMT)[+-]\d{1,2}(?::\d{2})?\b|\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/

const EN_WORDS_RE = /\b(the|and|you|with|this|that|for|have|what|from|your|are|was|can|not|we)\b/i

interface IndexedTurn {
  provider: RecallProvider
  sessionId: string
  turn: number
  role: RecallRole
  tsMs: number | null
  project: string | null
  quote: string
}

interface ScopeSql {
  clause: string
  params: string[]
}

function requireSqlite(): void {
  if (!recallSqliteSupported()) {
    throw new Error('Recall index requires Node.js 22 or newer (node:sqlite).')
  }
}

function asProvider(value: string | null): RecallProvider {
  if (value && (RECALL_PROVIDERS as readonly string[]).includes(value)) return value as RecallProvider
  return 'claude'
}

function parseTurn(row: Record<string, SQLOutputValue>): IndexedTurn {
  return {
    provider: asProvider(sqlString(row.provider)),
    sessionId: sqlString(row.session_id) ?? '',
    turn: sqlNumber(row.turn) ?? 0,
    role: sqlString(row.role) === 'user' ? 'user' : 'assistant',
    tsMs: sqlNumber(row.ts_ms),
    project: sqlString(row.project),
    quote: sqlString(row.quote) ?? ''
  }
}

function toCitation(turn: IndexedTurn): RecallCitation {
  return {
    provider: turn.provider,
    date: isoFromMs(turn.tsMs),
    project: turn.project,
    sessionId: turn.sessionId,
    turn: turn.turn,
    quote: turn.quote
  }
}

function takeCitations(turns: IndexedTurn[], max = MAX_CITATIONS): RecallCitation[] {
  const seen = new Set<string>()
  const citations: RecallCitation[] = []
  for (const turn of turns) {
    if (!turn.sessionId || turn.turn < 1 || !turn.quote.trim()) continue
    const key = `${turn.provider}:${turn.sessionId}:${turn.turn}`
    if (seen.has(key)) continue
    seen.add(key)
    citations.push(toCitation(turn))
    if (citations.length >= max) break
  }
  return citations
}

function citedItem(text: string, turns: IndexedTurn[]): RecallShelfItem | null {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  const citations = takeCitations(turns)
  if (!trimmed || citations.length === 0) return null
  return { text: trimmed, citations }
}

function ftsPhrase(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return `"${trimmed.replace(/"/g, '""')}"`
}

function collapseText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripGitComment(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  const hash = trimmed.indexOf('#')
  return (hash >= 0 ? trimmed.slice(0, hash) : trimmed).trim()
}

function parseGitConfigUser(text: string): { name: string | null; email: string | null } {
  let inUser = false
  let name: string | null = null
  let email: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      inUser = /^\[user\]$/i.test(line)
      continue
    }
    if (!inUser) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = stripGitComment(line.slice(eq + 1))
    if (!value) continue
    if (key === 'name' && !name) name = value
    if (key === 'email' && !email) email = value
  }
  return { name, email }
}

async function loadGitIdentity(
  homeDir: string,
  env: NodeJS.ProcessEnv
): Promise<{ name: string | null; email: string | null }> {
  let name = env.GIT_AUTHOR_NAME?.trim() || env.GIT_COMMITTER_NAME?.trim() || null
  let email = env.GIT_AUTHOR_EMAIL?.trim() || env.GIT_COMMITTER_EMAIL?.trim() || null
  if (name && email) return { name, email }

  const xdg = env.XDG_CONFIG_HOME?.trim()
  const files = [
    env.GIT_CONFIG_GLOBAL?.trim(),
    env.GIT_CONFIG?.trim(),
    path.join(homeDir, '.gitconfig'),
    xdg ? path.join(path.resolve(xdg), 'git', 'config') : path.join(homeDir, '.config', 'git', 'config')
  ].filter((file): file is string => Boolean(file))

  for (const filePath of files) {
    if (!(await pathExists(filePath))) continue
    try {
      const parsed = parseGitConfigUser(await readFile(filePath, 'utf8'))
      name = name ?? parsed.name
      email = email ?? parsed.email
      if (name && email) break
    } catch {
      // Unreadable gitconfig: keep whatever we already have.
    }
  }
  return { name, email }
}

function scopeClause(projects: string[] | null): ScopeSql {
  if (projects == null) return { clause: '1=1', params: [] }
  if (projects.length === 0) return { clause: '1=0', params: [] }
  return {
    clause: `project IN (${projects.map(() => '?').join(',')})`,
    params: projects
  }
}

function listIndexedProjects(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT DISTINCT project FROM turns WHERE project IS NOT NULL AND project != ''`)
    .all()
    .flatMap((row) => {
      const project = sqlString(row.project)
      return project ? [project] : []
    })
}

function scopedProjects(db: DatabaseSync, wanted: string | null): string[] | null {
  if (!wanted) return null
  return listIndexedProjects(db).filter((project) => projectMatches(project, wanted))
}

const TURN_COLUMNS = 'provider, session_id, turn, role, ts_ms, project, quote'
const TURN_COLUMNS_T = 't.provider, t.session_id, t.turn, t.role, t.ts_ms, t.project, t.quote'

function queryTurns(
  db: DatabaseSync,
  sql: string,
  params: Array<string | number>
): IndexedTurn[] {
  return db.prepare(sql).all(...params).map(parseTurn).filter((turn) => turn.sessionId && turn.quote)
}

function queryFtsTurns(
  db: DatabaseSync,
  match: string,
  scope: ScopeSql,
  limit: number
): IndexedTurn[] {
  if (!match) return []
  try {
    return queryTurns(
      db,
      `SELECT ${TURN_COLUMNS_T}
       FROM turns_fts
       JOIN turns t ON t.id = turns_fts.rowid
       WHERE turns_fts MATCH ? AND ${scope.clause}
       LIMIT ?`,
      [match, ...scope.params, limit]
    )
  } catch {
    return []
  }
}

function queryContaining(
  db: DatabaseSync,
  needle: string,
  scope: ScopeSql,
  limit: number
): IndexedTurn[] {
  const lowered = needle.trim().toLowerCase()
  if (lowered.length < 2) return []
  const fromFts = queryFtsTurns(db, ftsPhrase(needle), scope, limit).filter((turn) =>
    turn.quote.toLowerCase().includes(lowered)
  )
  if (fromFts.length > 0) return fromFts
  return queryTurns(
    db,
    `SELECT ${TURN_COLUMNS}
     FROM turns
     WHERE ${scope.clause} AND instr(lower(quote), ?) > 0
     ORDER BY COALESCE(ts_ms, 0) DESC
     LIMIT ?`,
    [...scope.params, lowered, limit]
  ).filter((turn) => turn.quote.toLowerCase().includes(lowered))
}

function sampleTurns(db: DatabaseSync, scope: ScopeSql, limit = SAMPLE_TURNS): IndexedTurn[] {
  return queryTurns(
    db,
    `SELECT ${TURN_COLUMNS}
     FROM turns
     WHERE ${scope.clause} AND quote != ''
     ORDER BY COALESCE(ts_ms, 0) DESC
     LIMIT ?`,
    [...scope.params, limit]
  )
}

function detectLanguages(turns: IndexedTurn[]): RecallShelfItem[] {
  const buckets = new Map<string, IndexedTurn[]>()
  const letterCounts = new Map<string, number>()

  const add = (code: string, turn: IndexedTurn, letters: number): void => {
    const list = buckets.get(code) ?? []
    if (list.length < MAX_CITATIONS) list.push(turn)
    buckets.set(code, list)
    letterCounts.set(code, (letterCounts.get(code) ?? 0) + letters)
  }

  for (const turn of turns) {
    if (turn.role !== 'user') continue
    const quote = turn.quote
    let cyrillic = 0
    let latin = 0
    let han = 0
    let hiragana = 0
    let ukChars = 0
    for (const char of quote) {
      const code = char.codePointAt(0) ?? 0
      if (code >= 0x0400 && code <= 0x04ff) {
        cyrillic += 1
        if ('іїєґІЇЄҐ'.includes(char)) ukChars += 1
      } else if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 0x00c0 && code <= 0x024f)) {
        latin += 1
      } else if (code >= 0x4e00 && code <= 0x9fff) {
        han += 1
      } else if (code >= 0x3040 && code <= 0x30ff) {
        hiragana += 1
      }
    }
    if (cyrillic >= 12) add(ukChars >= 3 ? 'uk' : 'ru', turn, cyrillic)
    if (latin >= 12 && EN_WORDS_RE.test(quote)) add('en', turn, latin)
    if (han >= 8) add('zh', turn, han)
    if (hiragana >= 8) add('ja', turn, hiragana)
    if ((/[äöüß]/i.test(quote) && /\b(und|nicht|ich|der|die|das)\b/i.test(quote)) || /ß/.test(quote)) {
      add('de', turn, latin)
    }
  }

  const items: RecallShelfItem[] = []
  const ranked = [...buckets.entries()].sort(
    (left, right) => (letterCounts.get(right[0]) ?? 0) - (letterCounts.get(left[0]) ?? 0)
  )
  for (const [code, evidence] of ranked) {
    const letters = letterCounts.get(code) ?? 0
    if (evidence.length < MIN_LANGUAGE_TURNS && letters < MIN_LANGUAGE_LETTERS * 2) continue
    if (letters < MIN_LANGUAGE_LETTERS) continue
    const item = citedItem(code, evidence)
    if (item) items.push(item)
  }
  return items
}

function detectAddressAs(turns: IndexedTurn[]): RecallShelfItem | null {
  for (const turn of turns) {
    if (turn.role !== 'user') continue
    for (const pattern of ADDRESS_RES) {
      const match = pattern.exec(turn.quote)
      if (!match?.[1]) continue
      const name = collapseText(match[1])
      if (name.length < 2) continue
      return citedItem(name, [turn])
    }
  }
  return null
}

function timezoneNeedles(tz: string): string[] {
  const needles = [tz]
  if (tz.includes('/')) {
    const city = tz.split('/').pop() ?? ''
    if (city.length >= 4) {
      needles.push(city)
      needles.push(city.replace(/_/g, ' '))
    }
  }
  return [...new Set(needles.filter((needle) => needle.length >= 3))]
}

function compileTimezone(
  db: DatabaseSync,
  scope: ScopeSql,
  env: NodeJS.ProcessEnv,
  sample: IndexedTurn[]
): RecallShelfItem | null {
  const tz = env.TZ?.trim()
  if (tz) {
    for (const needle of timezoneNeedles(tz)) {
      const hits = queryContaining(db, needle, scope, MAX_CITATIONS)
      const item = citedItem(tz, hits)
      if (item) return item
    }
  }
  for (const turn of sample) {
    const match = TZ_IN_TEXT_RE.exec(turn.quote)
    if (!match) continue
    return citedItem(match[0], [turn])
  }
  return null
}

function compileGitUser(
  db: DatabaseSync,
  scope: ScopeSql,
  identity: { name: string | null; email: string | null }
): RecallShelfItem | null {
  const nameHits = identity.name && identity.name.trim().length >= 2
    ? queryContaining(db, identity.name.trim(), scope, MAX_CITATIONS)
    : []
  const emailHits = identity.email && identity.email.includes('@')
    ? queryContaining(db, identity.email.trim(), scope, MAX_CITATIONS)
    : []
  if (nameHits.length === 0 && emailHits.length === 0) return null
  const text =
    identity.name && nameHits.length > 0 && identity.email && emailHits.length > 0
      ? `${identity.name.trim()} <${identity.email.trim()}>`
      : nameHits.length > 0 && identity.name
        ? identity.name.trim()
        : identity.email!.trim()
  return citedItem(text, [...nameHits, ...emailHits])
}

function compileWho(
  db: DatabaseSync,
  scope: ScopeSql,
  sample: IndexedTurn[],
  identity: { name: string | null; email: string | null },
  env: NodeJS.ProcessEnv
): RecallWho {
  return {
    languages: detectLanguages(sample),
    timezone: compileTimezone(db, scope, env, sample),
    gitUser: compileGitUser(db, scope, identity),
    addressAs: detectAddressAs(sample)
  }
}

function compileWork(db: DatabaseSync, projects: string[] | null): RecallWorkCluster[] {
  const rows = db
    .prepare(
      `SELECT project, COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions, MAX(ts_ms) AS last_ts
       FROM turns
       WHERE project IS NOT NULL AND project != ''
       GROUP BY project`
    )
    .all()

  const clusters: Array<{
    path: string
    sessions: number
    turns: number
    lastDate: string | null
  }> = []
  for (const row of rows) {
    const projectPath = sqlString(row.project)
    if (!projectPath) continue
    if (projects && !projects.includes(projectPath)) continue
    clusters.push({
      path: projectPath,
      sessions: sqlNumber(row.sessions) ?? 0,
      turns: sqlNumber(row.turns) ?? 0,
      lastDate: isoFromMs(sqlNumber(row.last_ts))
    })
  }
  clusters.sort((left, right) => right.sessions - left.sessions || right.turns - left.turns)

  const basenameCounts = new Map<string, number>()
  for (const cluster of clusters) {
    const base = path.basename(cluster.path) || cluster.path
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1)
  }

  const result: RecallWorkCluster[] = []
  for (const cluster of clusters.slice(0, MAX_WORK)) {
    const citations = takeCitations(
      queryTurns(
        db,
        `SELECT ${TURN_COLUMNS}
         FROM turns
         WHERE project = ? AND quote != ''
         ORDER BY CASE role WHEN 'user' THEN 0 ELSE 1 END, COALESCE(ts_ms, 0) DESC
         LIMIT ?`,
        [cluster.path, MAX_CITATIONS]
      )
    )
    if (citations.length === 0) continue
    const base = path.basename(cluster.path) || cluster.path
    const name =
      (basenameCounts.get(base) ?? 0) > 1
        ? `${path.basename(path.dirname(cluster.path))}/${base}`
        : base
    result.push({
      name,
      path: cluster.path,
      sessions: cluster.sessions,
      turns: cluster.turns,
      lastDate: cluster.lastDate,
      citations
    })
  }
  return result
}

function compileStack(sample: IndexedTurn[]): RecallShelfItem[] {
  const tech = new Map<string, IndexedTurn[]>()
  const techSessions = new Map<string, Set<string>>()
  for (const turn of sample) {
    for (const term of STACK_TERMS) {
      if (!term.pattern.test(turn.quote)) continue
      const list = tech.get(term.label) ?? []
      if (list.length < MAX_CITATIONS) list.push(turn)
      tech.set(term.label, list)
      const sessions = techSessions.get(term.label) ?? new Set<string>()
      sessions.add(turn.sessionId)
      techSessions.set(term.label, sessions)
    }
  }

  const items: RecallShelfItem[] = []
  const ranked = [...tech.entries()].sort(
    (left, right) => (techSessions.get(right[0])?.size ?? 0) - (techSessions.get(left[0])?.size ?? 0)
  )
  for (const [label, evidence] of ranked) {
    if ((techSessions.get(label)?.size ?? 0) < STACK_MIN_SESSIONS) continue
    const item = citedItem(label, evidence)
    if (item) items.push(item)
    if (items.length >= MAX_STACK) break
  }

  const habits = new Map<string, IndexedTurn[]>()
  const habitSessions = new Map<string, Set<string>>()
  for (const turn of sample) {
    if (turn.role !== 'user') continue
    for (const pattern of HABIT_RES) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(turn.quote)) !== null) {
        const text = collapseText(match[0] ?? '')
        if (text.length < 12) continue
        const key = text.toLowerCase()
        const list = habits.get(key) ?? []
        if (list.length < MAX_CITATIONS) list.push(turn)
        habits.set(key, list)
        const sessions = habitSessions.get(key) ?? new Set<string>()
        sessions.add(turn.sessionId)
        habitSessions.set(key, sessions)
      }
    }
  }
  let habitCount = 0
  for (const [text, evidence] of habits) {
    if ((habitSessions.get(text)?.size ?? 0) < STACK_MIN_SESSIONS) continue
    const item = citedItem(text, evidence)
    if (!item) continue
    items.push(item)
    habitCount += 1
    if (habitCount >= MAX_HABITS) break
  }
  return items
}

function isDecisionTurn(turn: IndexedTurn, snippet: string): boolean {
  if (turn.role === 'user') return true
  return ASSISTANT_DECISION_RE.test(snippet) || ASSISTANT_DECISION_RE.test(turn.quote)
}

function decisionSnippet(quote: string): string | null {
  for (const pattern of DECISION_RES) {
    const match = pattern.exec(quote)
    if (match?.[0]) return collapseText(match[0])
  }
  return null
}

function compileDecisions(db: DatabaseSync, scope: ScopeSql, sample: IndexedTurn[]): RecallDecision[] {
  const found = new Map<string, IndexedTurn>()
  for (const turn of [...queryFtsTurns(db, DECISION_FTS, scope, 80), ...sample]) {
    const key = `${turn.sessionId}:${turn.turn}`
    if (!found.has(key)) found.set(key, turn)
  }

  const decisions: RecallDecision[] = []
  const seenText = new Set<string>()
  const ranked = [...found.values()].sort((left, right) => (right.tsMs ?? 0) - (left.tsMs ?? 0))
  for (const turn of ranked) {
    const snippet = decisionSnippet(turn.quote)
    if (!snippet || !isDecisionTurn(turn, snippet)) continue
    const normalized = snippet.toLowerCase()
    if (seenText.has(normalized)) continue
    const citations = takeCitations([turn])
    if (citations.length === 0) continue
    seenText.add(normalized)
    decisions.push({
      text: snippet,
      date: isoFromMs(turn.tsMs),
      provider: turn.provider,
      citations
    })
    if (decisions.length >= MAX_DECISIONS) break
  }
  return decisions
}

function looksClosed(quote: string): boolean {
  return CLOSED_THREAD_RE.test(collapseText(quote))
}

function looksOpen(turn: IndexedTurn): boolean {
  const quote = collapseText(turn.quote)
  if (quote.length < 12 || looksClosed(quote)) return false
  if (turn.role === 'user') return true
  return OPEN_ASSISTANT_RE.test(quote)
}

function compileOpen(db: DatabaseSync, scope: ScopeSql, now: number): RecallOpenThread[] {
  const turns = queryTurns(
    db,
    `SELECT ${TURN_COLUMNS_T}
     FROM turns t
     INNER JOIN (
       SELECT session_id, MAX(turn) AS turn
       FROM turns
       WHERE ${scope.clause}
       GROUP BY session_id
     ) last ON last.session_id = t.session_id AND last.turn = t.turn
     WHERE ${scope.clause}
     ORDER BY COALESCE(t.ts_ms, 0) DESC
     LIMIT 40`,
    [...scope.params, ...scope.params]
  )

  const open: RecallOpenThread[] = []
  const seen = new Set<string>()
  for (const turn of turns) {
    if (seen.has(turn.sessionId)) continue
    if (turn.tsMs != null && now - turn.tsMs > OPEN_MAX_AGE_MS) continue
    if (!looksOpen(turn)) continue
    const citations = takeCitations([turn])
    if (citations.length === 0) continue
    seen.add(turn.sessionId)
    open.push({
      text: collapseText(turn.quote),
      sessionId: turn.sessionId,
      date: isoFromMs(turn.tsMs),
      provider: turn.provider,
      citations
    })
    if (open.length >= MAX_OPEN) break
  }
  return open
}

async function compileShelves(
  options: RecallShelfOptions,
  wantedProject: string | null
): Promise<RecallShelves> {
  requireSqlite()
  const homeDir = options.homeDir ?? getHomeDir()
  const env = options.env ?? process.env
  const indexPath = options.indexPath ?? getRecallIndexPath(homeDir)
  const identity = await loadGitIdentity(homeDir, env)
  const db = await openRecallDatabase(indexPath)
  try {
    const projects = scopedProjects(db, wantedProject)
    const scope = scopeClause(projects)
    const sample = sampleTurns(db, scope)
    return {
      who: compileWho(db, scope, sample, identity, env),
      work: compileWork(db, projects),
      stack: compileStack(sample),
      decisions: compileDecisions(db, scope, sample),
      open: wantedProject ? compileOpen(db, scope, Date.now()) : []
    }
  } finally {
    db.close()
  }
}

/**
 * Machine-wide person card compiled from cited turns. No LLM.
 * Facts without a citing turn are omitted. `open` stays empty (repo-scoped).
 */
export async function about(options: RecallShelfOptions = {}): Promise<RecallShelves> {
  return compileShelves(options, null)
}

/**
 * Project-scoped shelves for `cwd` (or `options.project`). Stack, decisions,
 * work, and open threads are limited to that repo. Every item is cited.
 */
export async function project(options: RecallShelfOptions = {}): Promise<RecallProjectShelves> {
  const cwd = options.cwd ?? process.cwd()
  const projectPath = normalizeProjectPath(options.project ?? cwd) ?? path.resolve(cwd)
  const shelves = await compileShelves(options, projectPath)
  return { project: projectPath, ...shelves }
}
