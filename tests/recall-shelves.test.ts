import { mkdir, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { about, get, ingest, project } from '../src/recall/index.js'
import { recallSqliteSupported } from '../src/recall/sqlite.js'
import type { RecallCitation, RecallShelves } from '../src/recall/types.js'

const describeRecall = recallSqliteSupported() ? describe : describe.skip

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function writeLines(filePath: string, lines: string[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function claudeTurn(
  role: 'user' | 'assistant',
  sessionId: string,
  cwd: string,
  timestamp: string,
  text: string
): string {
  return JSON.stringify({
    type: role,
    sessionId,
    cwd,
    timestamp,
    message: { content: text }
  })
}

function citedItems(shelves: RecallShelves): Array<{ text: string; citations: RecallCitation[] }> {
  return [
    ...shelves.who.languages,
    ...[shelves.who.timezone, shelves.who.gitUser, shelves.who.addressAs].filter(
      (item): item is NonNullable<typeof item> => item != null
    ),
    ...shelves.work,
    ...shelves.stack,
    ...shelves.decisions,
    ...shelves.open
  ]
}

function expectCited(item: { citations: RecallCitation[] }): void {
  expect(item.citations.length).toBeGreaterThan(0)
  for (const citation of item.citations) {
    expect(citation.provider).toMatch(/^(claude|codex|cursor|grok|gemini|aside|opencode)$/)
    expect(citation.sessionId.length).toBeGreaterThan(0)
    expect(citation.turn).toBeGreaterThan(0)
    expect(citation.quote.length).toBeGreaterThan(0)
    expect(citation).toHaveProperty('date')
    expect(citation).toHaveProperty('project')
  }
}

async function seedPersonCard(): Promise<{
  home: string
  indexPath: string
  app: string
  other: string
  env: NodeJS.ProcessEnv
}> {
  const home = await tempDir('agents-recall-shelves-')
  const indexPath = path.join(home, 'recall', 'index.sqlite')
  const app = path.join(home, 'work', 'app')
  const other = path.join(home, 'work', 'other')
  await mkdir(app, { recursive: true })
  await mkdir(other, { recursive: true })
  await writeFile(
    path.join(home, '.gitconfig'),
    '[user]\n\tname = Ada Example\n\temail = ada@example.com\n',
    'utf8'
  )

  const claudeApp = path.join(home, '.claude', 'projects', '-work-app')
  await writeLines(path.join(claudeApp, 'sess-app-a.jsonl'), [
    claudeTurn(
      'user',
      'sess-app-a',
      app,
      isoAgo(40),
      'Привет, это рабочая сессия. Меня зовут Ada Example. Я пишу на TypeScript и обычно держу тесты на Vitest.'
    ),
    claudeTurn(
      'assistant',
      'sess-app-a',
      app,
      isoAgo(39),
      'Ок, Ada Example, продолжим на TypeScript.'
    ),
    claudeTurn(
      'user',
      'sess-app-a',
      app,
      isoAgo(38),
      'we decided to use SQLite FTS5 for the recall index. I always run Vitest before shipping TypeScript changes.'
    ),
    claudeTurn(
      'assistant',
      'sess-app-a',
      app,
      isoAgo(37),
      'Sounds good, SQLite FTS5 it is.'
    )
  ])
  await writeLines(path.join(claudeApp, 'sess-app-b.jsonl'), [
    claudeTurn(
      'user',
      'sess-app-b',
      app,
      isoAgo(20),
      'Timezone is Europe/Helsinki. Still on TypeScript and Vitest for this work.'
    ),
    claudeTurn(
      'assistant',
      'sess-app-b',
      app,
      isoAgo(19),
      'You are a creative visionary and a passionate engineer. Vitest is already wired.'
    ),
    claudeTurn(
      'user',
      'sess-app-b',
      app,
      isoAgo(5),
      'Can you finish the ingest tests for this repo?'
    )
  ])

  const claudeOther = path.join(home, '.claude', 'projects', '-work-other')
  await writeLines(path.join(claudeOther, 'sess-other.jsonl'), [
    claudeTurn(
      'user',
      'sess-other',
      other,
      isoAgo(30),
      'Working on the billing rewrite in Python for the other repo.'
    ),
    claudeTurn(
      'assistant',
      'sess-other',
      other,
      isoAgo(29),
      'Python service noted.'
    ),
    claudeTurn(
      'user',
      'sess-other',
      other,
      isoAgo(28),
      'we decided to drop the old SOAP adapter.'
    ),
    claudeTurn(
      'assistant',
      'sess-other',
      other,
      isoAgo(27),
      'SOAP adapter is gone.'
    )
  ])

  const env: NodeJS.ProcessEnv = { TZ: 'Europe/Helsinki' }
  const result = await ingest({ homeDir: home, env: {}, indexPath, providers: ['claude'] })
  expect(result.errors).toEqual([])
  expect(result.turnsIndexed).toBeGreaterThan(8)
  return { home, indexPath, app, other, env }
}

describeRecall('recall shelves', () => {
  it('compiles a cited person card from heuristics, not an LLM', async () => {
    const { home, indexPath, app, other, env } = await seedPersonCard()
    const card = await about({ indexPath, homeDir: home, env })

    expect(card.open).toEqual([])
    expect(card.who.languages.map((item) => item.text).sort()).toEqual(['en', 'ru'])
    expect(card.who.gitUser?.text).toBe('Ada Example')
    expect(card.who.timezone?.text).toBe('Europe/Helsinki')
    expect(card.who.addressAs?.text).toBe('Ada Example')

    const workPaths = card.work.map((cluster) => cluster.path).sort()
    expect(workPaths).toEqual([app, other].sort())
    expect(card.work.every((cluster) => cluster.sessions >= 1 && cluster.turns >= 1)).toBe(true)

    const stack = card.stack.map((item) => item.text)
    expect(stack).toContain('TypeScript')
    expect(stack).toContain('Vitest')
    expect(stack).not.toContain('Python')

    const decisions = card.decisions.map((item) => item.text)
    expect(decisions.some((text) => /SQLite FTS5/i.test(text))).toBe(true)
    expect(decisions.some((text) => /SOAP/i.test(text))).toBe(true)
    expect(card.decisions.every((item) => item.provider === 'claude' && item.date != null)).toBe(true)

    const texts = citedItems(card).map((item) => item.text).join('\n')
    expect(texts).not.toMatch(/visionary|passionate|creative/i)
    for (const item of citedItems(card)) expectCited(item)

    const gitCitation = card.who.gitUser!.citations[0]
    const original = await get(gitCitation.sessionId, gitCitation.turn, {
      indexPath,
      homeDir: home,
      env: {}
    })
    expect(original?.text).toContain('Ada Example')
  })

  it('scopes project() to cwd and keeps open threads on the current repo', async () => {
    const { home, indexPath, app, other, env } = await seedPersonCard()
    const scoped = await project({ indexPath, homeDir: home, env, cwd: app })

    expect(scoped.project).toBe(app)
    expect(scoped.work.map((cluster) => cluster.path)).toEqual([app])
    expect(scoped.work.some((cluster) => cluster.path === other)).toBe(false)
    expect(scoped.decisions.some((item) => /SOAP/i.test(item.text))).toBe(false)
    expect(scoped.decisions.some((item) => /SQLite FTS5/i.test(item.text))).toBe(true)
    expect(scoped.stack.map((item) => item.text)).toContain('TypeScript')
    expect(scoped.stack.map((item) => item.text)).not.toContain('Python')
    expect(scoped.open.some((item) => item.sessionId === 'sess-app-b')).toBe(true)
    expect(scoped.open.some((item) => /ingest tests/i.test(item.text))).toBe(true)
    expect(scoped.open.some((item) => item.sessionId === 'sess-other')).toBe(false)
    for (const item of citedItems(scoped)) expectCited(item)

    const otherCard = await project({ indexPath, homeDir: home, env, cwd: other })
    expect(otherCard.project).toBe(other)
    expect(otherCard.work.map((cluster) => cluster.path)).toEqual([other])
    expect(otherCard.decisions.some((item) => /SOAP/i.test(item.text))).toBe(true)
    expect(otherCard.open.some((item) => item.sessionId === 'sess-app-b')).toBe(false)
  })

  it('omits git user and timezone when they cannot be cited from turns', async () => {
    const home = await tempDir('agents-recall-shelves-uncited-')
    const indexPath = path.join(home, 'recall', 'index.sqlite')
    const app = path.join(home, 'work', 'app')
    await mkdir(app, { recursive: true })
    await writeFile(path.join(home, '.gitconfig'), '[user]\n\tname = Hidden User\n', 'utf8')
    await writeLines(path.join(home, '.claude', 'projects', '-app', 's1.jsonl'), [
      claudeTurn('user', 's1', app, isoAgo(10), 'Please add a regression test for ingest.')
    ])
    await ingest({ homeDir: home, env: {}, indexPath, providers: ['claude'] })

    const card = await about({
      indexPath,
      homeDir: home,
      env: { TZ: 'America/New_York', GIT_AUTHOR_NAME: 'Hidden User' }
    })
    expect(card.who.gitUser).toBeNull()
    expect(card.who.timezone).toBeNull()
    expect(card.who.addressAs).toBeNull()
    for (const item of citedItems(card)) expectCited(item)
  })

  it('returns empty shelves for an empty index', async () => {
    const home = await tempDir('agents-recall-shelves-empty-')
    const indexPath = path.join(home, 'recall', 'index.sqlite')
    await ingest({ homeDir: home, env: {}, indexPath, providers: ['claude'] })
    const card = await about({ indexPath, homeDir: home, env: {} })
    expect(card).toEqual({
      who: { languages: [], timezone: null, gitUser: null, addressAs: null },
      work: [],
      stack: [],
      decisions: [],
      open: []
    })
  })
})
