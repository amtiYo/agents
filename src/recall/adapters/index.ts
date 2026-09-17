import type { RecallAdapter, RecallProvider } from '../types.js'
import { asideAdapter } from './aside.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { cursorAdapter } from './cursor.js'
import { geminiAdapter } from './gemini.js'
import { grokAdapter } from './grok.js'
import { opencodeAdapter } from './opencode.js'

export const RECALL_ADAPTERS: readonly RecallAdapter[] = [
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  grokAdapter,
  geminiAdapter,
  asideAdapter,
  opencodeAdapter
]

export function adapterById(id: RecallProvider): RecallAdapter {
  const adapter = RECALL_ADAPTERS.find((entry) => entry.id === id)
  if (!adapter) throw new Error(`Unknown recall adapter: ${id}`)
  return adapter
}
