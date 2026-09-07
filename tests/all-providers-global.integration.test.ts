import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../src/commands/init.js'
import { runDoctor } from '../src/commands/doctor.js'
import { runStatus } from '../src/commands/status.js'
import { loadAgentsConfig, saveAgentsConfig } from '../src/core/config.js'
import { pathExists } from '../src/core/fs.js'
import { performSync } from '../src/core/sync.js'
import { INTEGRATION_IDS } from '../src/integrations/registry.js'

const tempDirs: string[] = []
let previousHomeDir: string | undefined
let previousClaudeDesktopPath: string | undefined
let previousWindsurfPath: string | undefined

beforeEach(() => {
  previousHomeDir = process.env.AGENTS_HOME_DIR
  previousClaudeDesktopPath = process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
  previousWindsurfPath = process.env.AGENTS_WINDSURF_MCP_PATH
})

afterEach(async () => {
  if (previousHomeDir === undefined) {
    delete process.env.AGENTS_HOME_DIR
  } else {
    process.env.AGENTS_HOME_DIR = previousHomeDir
  }

  if (previousClaudeDesktopPath === undefined) {
    delete process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
  } else {
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = previousClaudeDesktopPath
  }

  if (previousWindsurfPath === undefined) {
    delete process.env.AGENTS_WINDSURF_MCP_PATH
  } else {
    process.env.AGENTS_WINDSURF_MCP_PATH = previousWindsurfPath
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('all providers global sync compatibility', () => {
  it('synchronizes all 11 supported integrations in global mode without conflicts', { timeout: 25000 }, async () => {
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), 'agents-all-providers-home-'))
    tempDirs.push(fakeHome)
    process.env.AGENTS_HOME_DIR = fakeHome

    const claudeDesktopFile = path.join(fakeHome, 'claude_desktop_config.json')
    const windsurfFile = path.join(fakeHome, 'windsurf_mcp.json')
    process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH = claudeDesktopFile
    process.env.AGENTS_WINDSURF_MCP_PATH = windsurfFile

    // Initialize in global mode
    await runInit({ projectRoot: fakeHome, force: true })

    // Enable all 11 integrations
    const config = await loadAgentsConfig(fakeHome)
    config.integrations.enabled = [...INTEGRATION_IDS]
    await saveAgentsConfig(fakeHome, config)

    // Add a custom skill to verify skill bridge sync for all tools
    const skillDir = path.join(fakeHome, '.agents', 'skills', 'my-global-skill')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-global-skill\ndescription: A machine-wide skill\n---\nGlobal skill instructions\n',
      'utf8'
    )

    // Run full sync in global mode
    const syncResult = await performSync({
      projectRoot: fakeHome,
      check: false,
      verbose: false
    })

    expect(syncResult.changed).toBeDefined()

    // Check outputs for EVERY provider:
    // 1. Codex
    const codexConfig = path.join(fakeHome, '.codex', 'config.toml')
    expect(await pathExists(codexConfig)).toBe(true)
    const codexContent = await readFile(codexConfig, 'utf8')
    expect(codexContent).toContain('BEGIN agents-sync managed MCP')

    // 2. Claude Desktop
    expect(await pathExists(claudeDesktopFile)).toBe(true)

    // 3. Gemini CLI
    const geminiConfig = path.join(fakeHome, '.gemini', 'settings.json')
    expect(await pathExists(geminiConfig)).toBe(true)

    // 4. Cursor
    const cursorConfig = path.join(fakeHome, '.cursor', 'mcp.json')
    expect(await pathExists(cursorConfig)).toBe(true)

    // 5. Copilot VS Code
    const vscodeMcp = path.join(fakeHome, '.vscode', 'mcp.json')
    expect(await pathExists(vscodeMcp)).toBe(true)

    // 6. Copilot CLI
    const copilotCliMcp = path.join(fakeHome, '.mcp.json')
    expect(await pathExists(copilotCliMcp)).toBe(true)

    // 7. Antigravity
    const antigravityMcp = path.join(fakeHome, '.agents', 'mcp_config.json')
    expect(await pathExists(antigravityMcp)).toBe(true)
    const antigravitySkills = path.join(fakeHome, '.gemini', 'skills', 'my-global-skill')
    expect(await pathExists(antigravitySkills)).toBe(true)

    // 8. Windsurf
    expect(await pathExists(windsurfFile)).toBe(true)
    const windsurfSkills = path.join(fakeHome, '.windsurf', 'skills')
    expect(await pathExists(windsurfSkills)).toBe(true)

    // 9. OpenCode
    const opencodeConfig = path.join(fakeHome, '.config', 'opencode', 'opencode.json')
    expect(await pathExists(opencodeConfig)).toBe(true)
    expect(await pathExists(path.join(fakeHome, 'opencode.json'))).toBe(false)

    // 10. Junie
    const junieConfig = path.join(fakeHome, '.junie', 'mcp', 'mcp.json')
    expect(await pathExists(junieConfig)).toBe(true)
    const junieSkills = path.join(fakeHome, '.junie', 'skills')
    expect(await pathExists(junieSkills)).toBe(true)

    // 11. Claude Code
    const claudeSkills = path.join(fakeHome, '.claude', 'skills')
    expect(await pathExists(claudeSkills)).toBe(true)
    const claudeMd = path.join(fakeHome, 'CLAUDE.md')
    expect(await pathExists(claudeMd)).toBe(true)

    // Status check in global mode
    let statusOutput = ''
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: unknown) => {
      statusOutput += String(chunk)
      return true
    }
    try {
      await runStatus({ projectRoot: fakeHome, json: true, fast: true, verbose: false })
    } finally {
      process.stdout.write = origWrite
    }
    const statusJson = JSON.parse(statusOutput) as { files: Record<string, boolean> }
    expect(statusJson.files['~/.config/opencode/opencode.json']).toBe(true)
    expect(statusJson.files['.codex/config.toml']).toBe(true)
    expect(statusJson.files['.cursor/mcp.json']).toBe(true)
    expect(statusJson.files['.gemini/settings.json']).toBe(true)

    // Doctor check in global mode
    await runDoctor({ projectRoot: fakeHome, fix: false })
  })
})
