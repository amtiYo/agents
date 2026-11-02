import os from 'node:os'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { afterAll } from 'vitest'

// Tests that reach the real Claude CLI must not write to the developer's ~/.claude.json,
// and a file left by one test file must not change what the next one reads.
const claudeConfigRoot = mkdtempSync(path.join(os.tmpdir(), 'agents-test-claude-'))
process.env.CLAUDE_CONFIG_DIR = path.join(claudeConfigRoot, 'config')

afterAll(() => {
  rmSync(claudeConfigRoot, { recursive: true, force: true })
})
