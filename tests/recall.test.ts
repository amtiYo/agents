import { mkdir, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, get, ingest, search } from '../src/recall/index.js'
import { cursorUserRoot } from '../src/recall/paths.js'
import { redactSecrets } from '../src/recall/redact.js'
import { toFtsQuery } from '../src/recall/search.js'
import { recallSqliteSupported } from '../src/recall/sqlite.js'

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

describe('recall redaction', () => {
  it('redacts tokens, PEM blocks, and authenticated URLs before they can be stored', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0secretkeymaterialhere\n-----END RSA PRIVATE KEY-----'
    const text = [
      'token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signaturepad',
      'postgres://deploy:hunter2-super-secret@db.internal/app',
      pem,
      'AKIAIOSFODNN7EXAMPLE'
    ].join('\n')

    const result = redactSecrets(text)
    expect(result.count).toBeGreaterThan(0)
    expect(result.text).not.toContain('sk-ant-api03')
    expect(result.text).not.toContain('hunter2-super-secret')
    expect(result.text).not.toContain('MIIEowIBAAKCAQEA0secretkeymaterialhere')
    expect(result.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(result.text).toContain('[redacted]')
  })
})

describe('recall fts query', () => {
  it('quotes hyphenated identifiers so FTS5 treats them as phrases', () => {
    expect(toFtsQuery('  OmniRoute rollback  ')).toBe('OmniRoute AND rollback')
    expect(toFtsQuery('MOV-144')).toBe('"MOV-144"')
    expect(toFtsQuery('')).toBeNull()
  })
})

describeRecall('recall adapters + FTS5 index', () => {
  it('indexes speech only, redacts secrets, skips subagents, and searches by project', async () => {
    const home = await tempDir('agents-recall-home-')
    const indexPath = path.join(home, 'recall', 'index.sqlite')
    const app = path.join(home, 'work', 'app')
    const other = path.join(home, 'work', 'other')
    await mkdir(app, { recursive: true })
    await mkdir(other, { recursive: true })

    const claudeProject = path.join(home, '.claude', 'projects', '-tmp-app')
    await writeLines(path.join(claudeProject, 'sess-claude.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-claude',
        cwd: app,
        timestamp: '2026-03-14T10:00:00Z',
        message: { content: 'How did we roll back OmniRoute last time?' }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-claude',
        cwd: app,
        timestamp: '2026-03-14T10:00:05Z',
        message: {
          content: [
            { type: 'text', text: 'Use the digest pull. Token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'src/omniroute.ts' } }
          ]
        }
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-claude',
        timestamp: '2026-03-14T10:00:06Z',
        message: { content: [{ type: 'tool_result', content: 'BASE64_TOOL_DUMP'.repeat(20) }] }
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        sessionId: 'sess-claude',
        message: { content: 'sidechain duplicate that must not be indexed' }
      })
    ])
    await writeLines(path.join(claudeProject, 'subagents', 'agent-1.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'agent-1',
        cwd: app,
        message: { content: 'subagent task should be skipped' }
      })
    ])

    const otherClaude = path.join(home, '.config', 'claude', 'projects', '-tmp-other')
    await writeLines(path.join(otherClaude, 'sess-other.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-other',
        cwd: other,
        timestamp: '2026-03-14T11:00:00Z',
        message: { content: 'unrelated other-project secret MOV-999' }
      })
    ])

    await writeLines(path.join(home, '.codex', 'sessions', '2026', '03', '14', 'rollout-sess-codex.jsonl'), [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'sess-codex', cwd: app, timestamp: '2026-03-14T12:00:00Z' }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-14T12:00:01Z',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Codex OmniRoute rollback notes' }] }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls src/omniroute.ts"}' }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', output: 'TOOL_STDOUT_SHOULD_NOT_INDEX'.repeat(50) }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-03-14T12:00:02Z',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex applied the OmniRoute rollback.' }] }
      })
    ])
    await writeLines(path.join(home, '.codex', 'sessions', '2026', '03', '14', 'rollout-child.jsonl'), [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'child-session', forked_from_id: 'sess-codex', thread_source: 'subagent', cwd: app }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'subagent replay' }] }
      })
    ])

    await writeLines(
      path.join(home, '.cursor', 'projects', 'tmp-app', 'agent-transcripts', 'cursor-cli.jsonl'),
      [
        JSON.stringify({
          role: 'user',
          message: { content: [{ type: 'text', text: 'Cursor CLI question about OmniRoute' }] }
        }),
        JSON.stringify({
          role: 'assistant',
          message: { content: [{ type: 'text', text: 'Cursor CLI answer' }] }
        })
      ]
    )
    await writeLines(
      path.join(home, '.cursor', 'projects', 'tmp-app', 'agent-transcripts', 'subagents', 'nested.jsonl'),
      [JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'cursor subagent' }] } })]
    )

    const cursorDb = path.join(cursorUserRoot(home, {}), 'globalStorage', 'state.vscdb')
    await mkdir(path.dirname(cursorDb), { recursive: true })
    const sqlite = await import('node:sqlite')
    const cursorStore = new sqlite.DatabaseSync(cursorDb)
    cursorStore.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)')
    cursorStore.prepare('INSERT INTO cursorDiskKV(key, value) VALUES(?, ?)').run(
      'composerData:cmp-1',
      JSON.stringify({ composerId: 'cmp-1', name: 'IDE', createdAt: 1_773_489_600_000, lastUpdatedAt: 1_773_489_610_000 })
    )
    cursorStore.prepare('INSERT INTO cursorDiskKV(key, value) VALUES(?, ?)').run(
      'bubbleId:cmp-1:b1',
      JSON.stringify({
        type: 1,
        text: 'IDE user turn about OmniRoute',
        timestamp: 1_773_489_600_000,
        workspaceProjectDir: app
      })
    )
    cursorStore.prepare('INSERT INTO cursorDiskKV(key, value) VALUES(?, ?)').run(
      'bubbleId:cmp-1:b2',
      JSON.stringify({
        type: 2,
        text: 'IDE assistant reply',
        timestamp: 1_773_489_601_000,
        workspaceProjectDir: app
      })
    )
    cursorStore.close()

    const grokDir = path.join(home, '.grok', 'sessions', encodeURIComponent(app), 'sess-grok')
    await mkdir(grokDir, { recursive: true })
    await writeFile(
      path.join(grokDir, 'summary.json'),
      JSON.stringify({ info: { id: 'sess-grok', cwd: app }, session_kind: 'interactive' }),
      'utf8'
    )
    await writeLines(path.join(grokDir, 'updates.jsonl'), [
      JSON.stringify({
        timestamp: 1_773_489_700_000,
        params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Grok asks about OmniRoute' } } }
      }),
      JSON.stringify({
        timestamp: 1_773_489_701_000,
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Grok ' } }, _meta: { promptId: 'p1' } }
      }),
      JSON.stringify({
        timestamp: 1_773_489_702_000,
        params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answers OmniRoute.' } }, _meta: { promptId: 'p1' } }
      }),
      JSON.stringify({
        timestamp: 1_773_489_703_000,
        params: { update: { sessionUpdate: 'tool_call', content: [{ type: 'content', content: { type: 'text', text: 'tool stdout dump' } }] } }
      })
    ])
    const grokSub = path.join(home, '.grok', 'sessions', encodeURIComponent(app), 'sess-grok-sub')
    await mkdir(grokSub, { recursive: true })
    await writeFile(
      path.join(grokSub, 'summary.json'),
      JSON.stringify({ info: { id: 'sess-grok-sub', cwd: app }, session_kind: 'subagent' }),
      'utf8'
    )
    await writeLines(path.join(grokSub, 'updates.jsonl'), [
      JSON.stringify({
        params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'grok subagent' } } }
      })
    ])

    await mkdir(path.join(home, '.gemini', 'tmp', 'projhash', 'chats'), { recursive: true })
    await writeFile(path.join(home, '.gemini', 'tmp', 'projhash', '.project_root'), `${app}\n`, 'utf8')
    await writeFile(
      path.join(home, '.gemini', 'tmp', 'projhash', 'chats', 'session-2026-03-14.json'),
      JSON.stringify({
        sessionId: 'sess-gemini',
        messages: [
          { id: 'g1', timestamp: '2026-03-14T13:00:00Z', type: 'user', content: [{ text: 'Gemini OmniRoute question' }] },
          { id: 'g2', timestamp: '2026-03-14T13:00:01Z', type: 'gemini', content: [{ text: 'Gemini OmniRoute answer' }], toolCalls: [{ name: 'read_file', args: { path: 'src/a.ts' } }] },
          { id: 'g3', timestamp: '2026-03-14T13:00:02Z', type: 'info', content: 'noise' }
        ]
      }),
      { encoding: 'utf8' }
    )

    await writeLines(path.join(home, '.aside', 'u', '0', 'sessions', 'sess-aside', 'messages.jsonl'), [
      JSON.stringify({ role: 'user', timestamp: 1_773_489_800_000, content: 'Aside user OmniRoute' }),
      JSON.stringify({
        role: 'assistant',
        timestamp: 1_773_489_801_000,
        content: 'Aside assistant OmniRoute',
        usage: { input: 1, output: 1 }
      }),
      JSON.stringify({ role: 'toolResult', content: 'aside tool dump' })
    ])

    const opencodeDb = path.join(home, '.local', 'share', 'opencode', 'opencode.db')
    await mkdir(path.dirname(opencodeDb), { recursive: true })
    const openDb = new sqlite.DatabaseSync(opencodeDb)
    openDb.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `)
    openDb.prepare('INSERT INTO session VALUES(?, ?, ?, ?)').run('sess-opencode', app, 1, 2)
    openDb.prepare('INSERT INTO message VALUES(?, ?, ?, ?)').run(
      'm1',
      'sess-opencode',
      JSON.stringify({ role: 'user', time: { created: 1_773_489_900_000 } }),
      1_773_489_900_000
    )
    openDb.prepare('INSERT INTO part VALUES(?, ?, ?)').run(
      'p1',
      'm1',
      JSON.stringify({ type: 'text', text: 'OpenCode OmniRoute user' })
    )
    openDb.prepare('INSERT INTO message VALUES(?, ?, ?, ?)').run(
      'm2',
      'sess-opencode',
      JSON.stringify({ role: 'assistant', time: { created: 1_773_489_901_000 } }),
      1_773_489_901_000
    )
    openDb.prepare('INSERT INTO part VALUES(?, ?, ?)').run(
      'p2',
      'm2',
      JSON.stringify({ type: 'text', text: 'OpenCode OmniRoute assistant' })
    )
    openDb.prepare('INSERT INTO part VALUES(?, ?, ?)').run(
      'p3',
      'm2',
      JSON.stringify({ type: 'tool', tool: 'bash', state: { output: 'should not index' } })
    )
    openDb.close()

    const env: NodeJS.ProcessEnv = {}
    const first = await ingest({ homeDir: home, env, indexPath })
    expect(first.errors).toEqual([])
    expect(first.skippedSubagents).toBeGreaterThanOrEqual(3)
    expect(first.turnsIndexed).toBeGreaterThan(8)
    expect(first.redacted).toBeGreaterThan(0)

    const stats = await doctor({ indexPath })
    expect(stats.wal).toBe(true)
    expect(stats.files).toBeGreaterThan(0)
    expect(stats.turns).toBe(first.turnsIndexed)
    expect(stats.redacted).toBe(first.redacted)
    expect(stats.skippedSubagents).toBeGreaterThanOrEqual(3)
    expect(stats.providers.claude.turns).toBeGreaterThan(0)
    expect(stats.providers.codex.turns).toBeGreaterThan(0)
    expect(stats.providers.cursor.turns).toBeGreaterThan(0)
    expect(stats.providers.grok.turns).toBeGreaterThan(0)
    expect(stats.providers.gemini.turns).toBeGreaterThan(0)
    expect(stats.providers.aside.turns).toBeGreaterThan(0)
    expect(stats.providers.opencode.turns).toBeGreaterThan(0)

    const second = await ingest({ homeDir: home, env, indexPath })
    expect(second.filesUnchanged).toBeGreaterThan(0)
    expect(second.filesIndexed).toBe(0)
    expect(second.turnsIndexed).toBe(0)

    const hits = await search('OmniRoute', { indexPath, project: app, cwd: app, limit: 20 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((hit) => hit.quote.includes('sk-ant'))).toBe(false)
    expect(hits.some((hit) => hit.quote.includes('TOOL_STDOUT'))).toBe(false)
    expect(hits.some((hit) => hit.quote.includes('sidechain duplicate'))).toBe(false)
    expect(hits.some((hit) => /subagent task|subagent replay|cursor subagent|grok subagent/.test(hit.quote))).toBe(false)
    expect(hits.some((hit) => hit.tools.includes('Read'))).toBe(true)
    expect(hits.some((hit) => hit.paths.includes('src/omniroute.ts'))).toBe(true)
    expect(hits.some((hit) => hit.sessionId === 'sess-other')).toBe(false)

    const scoped = await search('MOV-999', { indexPath, project: app, cwd: app })
    expect(scoped).toEqual([])
    const globalHits = await search('MOV-999', { indexPath, all: true })
    expect(globalHits.some((hit) => hit.sessionId === 'sess-other')).toBe(true)

    const retrieved = await get('sess-claude', 1, { indexPath, homeDir: home, env })
    expect(retrieved).not.toBeNull()
    expect(retrieved?.sourceMissing).toBe(false)
    expect(retrieved?.text).toContain('roll back OmniRoute')
    expect(retrieved?.sourcePath).toContain('sess-claude.jsonl')

    const grokHit = await get('sess-grok', 2, { indexPath, homeDir: home, env })
    expect(grokHit?.text).toContain('Grok answers OmniRoute')

    await writeLines(path.join(claudeProject, 'sess-claude.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-claude',
        cwd: app,
        timestamp: '2026-03-14T10:00:00Z',
        message: { content: 'How did we roll back OmniRoute last time?' }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-claude',
        cwd: app,
        timestamp: '2026-03-14T10:00:05Z',
        message: { content: 'Use the digest pull.' }
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-claude',
        cwd: app,
        timestamp: '2026-03-14T15:00:00Z',
        message: { content: 'Follow-up about digest pull 403' }
      })
    ])
    const stamp = new Date()
    await utimes(path.join(claudeProject, 'sess-claude.jsonl'), stamp, stamp)

    const third = await ingest({ homeDir: home, env, indexPath })
    expect(third.filesIndexed).toBe(1)
    expect(third.turnsIndexed).toBe(3)

    const follow = await search('digest pull 403', { indexPath, project: app, cwd: app })
    expect(follow.some((hit) => hit.quote.includes('403'))).toBe(true)
  })

  it('treats a Cursor database without cursorDiskKV as empty instead of throwing', async () => {
    const home = await tempDir('agents-recall-cursor-')
    const indexPath = path.join(home, 'index.sqlite')
    const dbPath = path.join(cursorUserRoot(home, {}), 'globalStorage', 'state.vscdb')
    await mkdir(path.dirname(dbPath), { recursive: true })
    const sqlite = await import('node:sqlite')
    const db = new sqlite.DatabaseSync(dbPath)
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)')
    db.prepare('INSERT INTO ItemTable VALUES(?, ?)').run('unrelated', '{"ok":true}')
    db.close()

    const result = await ingest({ homeDir: home, env: {}, indexPath, providers: ['cursor'] })
    expect(result.errors).toEqual([])
    const stats = await doctor({ indexPath })
    expect(stats.providers.cursor.turns).toBe(0)
  })

  it('does not drop another provider when ingesting a subset', async () => {
    const home = await tempDir('agents-recall-subset-')
    const indexPath = path.join(home, 'index.sqlite')
    const app = path.join(home, 'app')
    await mkdir(app, { recursive: true })
    await writeLines(path.join(home, '.claude', 'projects', '-app', 's1.jsonl'), [
      JSON.stringify({
        type: 'user',
        sessionId: 'claude-keep',
        cwd: app,
        message: { content: 'claude stays' }
      })
    ])
    await writeLines(path.join(home, '.codex', 'sessions', 'rollout-keep.jsonl'), [
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-keep', cwd: app } }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex stays' }] }
      })
    ])

    await ingest({ homeDir: home, env: {}, indexPath })
    await ingest({ homeDir: home, env: {}, indexPath, providers: ['codex'] })
    const stats = await doctor({ indexPath })
    expect(stats.providers.claude.turns).toBeGreaterThan(0)
    expect(stats.providers.codex.turns).toBeGreaterThan(0)
  })
})
