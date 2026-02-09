import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { parse, type ParseError } from 'jsonc-parser'
import { loadAgentsConfig } from '../core/config.js'
import { listDirNames, pathExists, readJson } from '../core/fs.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { getProjectPaths } from '../core/paths.js'
import { commandExists, runCommand } from '../core/shell.js'
import { getCodexTrustState } from '../core/trust.js'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import { listCursorMcpStatuses, sanitizeTerminalOutput } from '../core/cursorCli.js'
import * as ui from '../core/ui.js'

export interface StatusOptions {
  projectRoot: string
  json: boolean
  verbose: boolean
  fast: boolean
}

interface StatusOutput {
  projectRoot: string
  mcpSource: {
    config: string
    localOverride: string
  }
  enabledIntegrations: string[]
  syncMode: string
  selectedMcpServers: string[]
  mcp: {
    configured: number
    localOverrides: number
  }
  vscode: {
    hideGenerated: boolean
    hiddenPaths: string[]
  }
  files: Record<string, boolean>
  probes: Record<string, string>
  probesSkipped: boolean
}

export async function runStatus(options: StatusOptions): Promise<void> {
  ui.setContext({ json: options.json })

  const config = await loadAgentsConfig(options.projectRoot)
  const resolved = await loadResolvedRegistry(options.projectRoot)
  const mcpState = await loadMcpState(options.projectRoot)
  const mcpEntries = listMcpEntries(mcpState)
  const paths = getProjectPaths(options.projectRoot)
  const expectedCodexServers = resolved.serversByTarget.codex.map((server) => server.name)
  const expectedCursorServers = resolved.serversByTarget.cursor.map((server) => server.name)

  const files: Record<string, boolean> = {
    '.agents/agents.json': await pathExists(paths.agentsConfig),
    '.agents/local.json': await pathExists(paths.agentsLocal),
    '.agents/skills/': await pathExists(paths.agentsSkillsDir),
    'AGENTS.md': await pathExists(paths.rootAgentsMd),
    '.codex/config.toml': await pathExists(paths.codexConfig),
    '.gemini/settings.json': await pathExists(paths.geminiSettings),
    '.vscode/mcp.json': await pathExists(paths.vscodeMcp),
    '.vscode/settings.json': await pathExists(paths.vscodeSettings),
    '.cursor/mcp.json': await pathExists(paths.cursorMcp),
    '.antigravity/mcp.json': await pathExists(paths.antigravityProjectMcp)
  }
  if (config.integrations.enabled.includes('claude')) {
    files['.claude/skills'] = await pathExists(paths.claudeSkillsBridge)
  }
  if (config.integrations.enabled.includes('cursor')) {
    files['.cursor/skills'] = await pathExists(paths.cursorSkillsBridge)
  }
  if (config.integrations.enabled.includes('gemini')) {
    files['.gemini/skills'] = await pathExists(paths.geminiSkillsBridge)
  }

  const probes: Record<string, string> = {}
  if (!options.fast) {
    if (config.integrations.enabled.includes('codex')) probes.codex = probeCodex(options.projectRoot, expectedCodexServers)
    if (config.integrations.enabled.includes('codex')) probes.codex_trust = await probeCodexTrust(options.projectRoot)
    if (config.integrations.enabled.includes('claude')) probes.claude = probeClaude(options.projectRoot)
    if (config.integrations.enabled.includes('gemini')) probes.gemini = probeGemini(options.projectRoot)
    if (config.integrations.enabled.includes('copilot_vscode')) probes.copilot_vscode = await probeCopilot(paths.vscodeMcp)
    if (config.integrations.enabled.includes('cursor')) probes.cursor = probeCursor(options.projectRoot, expectedCursorServers)
    if (config.integrations.enabled.includes('antigravity')) {
      probes.antigravity = await probeAntigravity(paths.antigravityProjectMcp)
    }
    probes.skills = await probeSkills(paths.agentsSkillsDir)
    probes.vscode_hidden = await probeVscodeHidden(paths.vscodeSettings)
  }

  if (resolved.missingRequiredEnv.length > 0) {
    probes.env = `missing required env: ${resolved.missingRequiredEnv.join('; ')}`
  }

  const output: StatusOutput = {
    projectRoot: path.resolve(options.projectRoot),
    mcpSource: {
      config: '.agents/agents.json',
      localOverride: '.agents/local.json'
    },
    enabledIntegrations: config.integrations.enabled,
    syncMode: config.syncMode,
    selectedMcpServers: resolved.selectedServerNames,
    mcp: {
      configured: mcpEntries.length,
      localOverrides: mcpEntries.filter((entry) => entry.hasLocalOverride).length
    },
    vscode: {
      hideGenerated: config.workspace.vscode.hideGenerated,
      hiddenPaths: config.workspace.vscode.hiddenPaths
    },
    files,
    probes,
    probesSkipped: options.fast
  }

  if (options.json) {
    ui.json(output)
    return
  }

  if (!options.verbose) {
    ui.keyValue('Project', output.projectRoot)
    ui.keyValue('Integrations', ui.formatList(output.enabledIntegrations))
    ui.keyValue('Sync mode', output.syncMode)
    ui.keyValue('MCP', `${output.mcp.configured} configured, ${output.mcp.localOverrides} local override(s)`)
    ui.keyValue('Selected MCP', ui.formatList(output.selectedMcpServers))

    const compactProbeOrder = ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity']
    const compactProbes = compactProbeOrder
      .filter((name) => Boolean(output.probes[name]))
      .map((name) => `${name}: ${output.probes[name]}`)
    if (output.probesSkipped) {
      ui.keyValue('Probes', 'skipped (--fast)')
    } else if (compactProbes.length > 0) {
      ui.keyValue('Probes', compactProbes.join(' | '))
    }
    ui.blank()
    ui.hint('run "agents status --verbose" for files/probes breakdown.')
    return
  }

  // Verbose output
  ui.keyValue('Project', output.projectRoot)
  ui.keyValue('MCP source', `${output.mcpSource.config} + ${output.mcpSource.localOverride}`)
  ui.keyValue('Integrations', ui.formatList(output.enabledIntegrations))
  ui.keyValue('Sync mode', output.syncMode)
  ui.keyValue('Selected MCP', ui.formatList(output.selectedMcpServers))
  ui.keyValue('MCP totals', `${output.mcp.configured} configured, ${output.mcp.localOverrides} with local overrides`)
  ui.keyValue(
    'VS Code hide',
    `${output.vscode.hideGenerated ? 'enabled' : 'disabled'} (${output.vscode.hiddenPaths.length} path(s))`
  )

  ui.blank()
  ui.section('Files', () => {
    ui.statusList(
      Object.entries(output.files).map(([file, exists]) => ({
        label: file,
        ok: exists,
        detail: exists ? undefined : 'missing'
      }))
    )
  })

  ui.blank()
  ui.section('Probes', () => {
    if (output.probesSkipped) {
      ui.dim('  skipped (--fast)')
    } else {
      for (const [name, result] of Object.entries(output.probes)) {
        ui.writeln(`  ${name}: ${result}`)
      }
    }
  })
}

function probeCodex(projectRoot: string, expectedServerNames: string[]): string {
  if (!commandExists('codex')) return 'codex CLI not found'
  const result = runCommand('codex', ['mcp', 'list', '--json'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  try {
    const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>
    const visible = extractCodexServerNames(parsed)
    const missing = expectedServerNames.filter((name) => !visible.includes(name))
    if (missing.length > 0) {
      return `${visible.length} visible in codex mcp list (${visible.join(', ') || 'none'}); project-selected not in list (${missing.join(', ')}).`
    }
    return `${visible.length} MCP server(s) visible (${visible.join(', ') || 'none'})`
  } catch {
    return 'ok (unparsed output)'
  }
}

function probeClaude(projectRoot: string): string {
  if (!commandExists('claude')) return 'claude CLI not found'
  const result = runCommand('claude', ['mcp', 'list'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  const lines = sanitizeTerminalOutput(result.stdout)
    .split('\n')
    .map((line) => line.trim())
  const managedLines = lines.filter((line) => line.startsWith('agents__'))
  const managed = managedLines.length
  const unhealthy = managedLines.filter((line) => line.includes('\u2717') || line.toLowerCase().includes('failed')).length
  if (unhealthy > 0) {
    return `${managed} managed MCP server(s), ${unhealthy} unhealthy`
  }
  return `${managed} managed MCP server(s) detected`
}

function probeGemini(projectRoot: string): string {
  if (!commandExists('gemini')) return 'gemini CLI not found'
  const result = runCommand('gemini', ['mcp', 'list'], projectRoot)
  const output = sanitizeTerminalOutput(`${result.stdout}\n${result.stderr}`)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  if (output.includes('Invalid configuration')) return 'invalid Gemini config detected'
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const disconnected = lines.filter((line) => line.includes('\u2717') || line.toLowerCase().includes('disconnected'))
  if (disconnected.length > 0) {
    return `gemini has ${disconnected.length} disconnected server(s)`
  }
  return 'gemini mcp list succeeded'
}

async function probeCopilot(vscodeMcpPath: string): Promise<string> {
  if (!(await pathExists(vscodeMcpPath))) return 'missing .vscode/mcp.json'
  try {
    const parsed = await readJson<{ servers?: Record<string, unknown> }>(vscodeMcpPath)
    const count = Object.keys(parsed.servers ?? {}).length
    return `${count} server(s) configured`
  } catch {
    return 'invalid JSON'
  }
}

function probeCursor(projectRoot: string, expectedServerNames: string[]): string {
  if (!commandExists('cursor-agent')) return 'cursor-agent CLI not found'
  const listed = listCursorMcpStatuses(projectRoot)
  if (!listed.ok) return `failed (${compact(listed.stderr)})`

  const entries = Object.entries(listed.statuses)
  const loaded = entries.filter(([, status]) => status === 'ready').length
  const notApproved = entries.filter(([, status]) => status === 'needs-approval').length
  const disabled = entries.filter(([, status]) => status === 'disabled').length
  const unknown = entries.filter(([, status]) => status === 'unknown').length
  const missing = expectedServerNames.filter((name) => !Object.prototype.hasOwnProperty.call(listed.statuses, name))

  const parts = [`${loaded} ready`]
  if (notApproved > 0) parts.push(`${notApproved} need approval`)
  if (disabled > 0) parts.push(`${disabled} disabled`)
  if (unknown > 0) parts.push(`${unknown} unknown`)
  if (missing.length > 0) parts.push(`missing in list: ${missing.join(', ')}`)
  return parts.join(', ')
}

async function probeAntigravity(projectPath: string): Promise<string> {
  if (!(await pathExists(projectPath))) return 'missing .antigravity/mcp.json'

  try {
    const parsed = await readJson<{ servers?: Record<string, unknown>; mcpServers?: Record<string, unknown> }>(projectPath)
    const count = Object.keys(parsed.servers ?? parsed.mcpServers ?? {}).length
    return `${count} server(s) configured (runtime state visible only in Antigravity UI)`
  } catch {
    return 'invalid .antigravity/mcp.json'
  }
}

async function probeSkills(skillsDir: string): Promise<string> {
  if (!(await pathExists(skillsDir))) return 'skills directory missing'

  const existing = await listDirNames(skillsDir)
  return `${existing.length} skill folder(s) present`
}

async function probeVscodeHidden(settingsPath: string): Promise<string> {
  if (!(await pathExists(settingsPath))) return 'settings file missing'
  try {
    const raw = await readFile(settingsPath, 'utf8')
    const errors: ParseError[] = []
    const parsed = parse(raw, errors, {
      allowTrailingComma: true,
      disallowComments: false
    }) as Record<string, unknown>
    if (errors.length > 0) {
      return 'invalid JSONC'
    }
    const filesExclude = parsed['files.exclude']
    const searchExclude = parsed['search.exclude']
    const filesCount = typeof filesExclude === 'object' && filesExclude !== null ? Object.keys(filesExclude).length : 0
    const searchCount = typeof searchExclude === 'object' && searchExclude !== null ? Object.keys(searchExclude).length : 0
    return `${filesCount} files.exclude, ${searchCount} search.exclude`
  } catch {
    return 'invalid JSONC'
  }
}

function compact(input: string): string {
  return input.trim().split('\n').at(-1) ?? 'unknown'
}

async function probeCodexTrust(projectRoot: string): Promise<string> {
  const state = await getCodexTrustState(projectRoot)
  return state === 'trusted' ? 'trusted' : 'untrusted'
}

function extractCodexServerNames(entries: Array<Record<string, unknown>>): string[] {
  const names: string[] = []
  for (const entry of entries) {
    const candidates = [entry.name, entry.id, entry.server, entry.server_label, entry.Name]
    const match = candidates.find((candidate) => typeof candidate === 'string')
    if (typeof match === 'string') {
      names.push(match)
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}
