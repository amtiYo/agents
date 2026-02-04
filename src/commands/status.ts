import { createHash } from 'node:crypto'
import path from 'node:path'
import { ensureGlobalCatalog } from '../core/catalog.js'
import { loadProjectConfig } from '../core/config.js'
import { listDirNames, pathExists, readJson } from '../core/fs.js'
import { loadSelection, loadResolvedRegistry } from '../core/mcp.js'
import { getAntigravityUserMcpPath, getProjectPaths } from '../core/paths.js'
import { commandExists, runCommand } from '../core/shell.js'
import { getCodexTrustState } from '../core/trust.js'
import type { CatalogFile, ProjectConfig } from '../types.js'

export interface StatusOptions {
  projectRoot: string
  json: boolean
}

interface StatusOutput {
  projectRoot: string
  mcpSource: {
    catalog: string
    selection: string
    localOverride: string
  }
  enabledIntegrations: string[]
  syncMode: string
  selectedMcpServers: string[]
  selectedSkillPacks: string[]
  selectedSkills: string[]
  resolvedSkills: string[]
  files: Record<string, boolean>
  probes: Record<string, string>
}

export async function runStatus(options: StatusOptions): Promise<void> {
  const config = await loadProjectConfig(options.projectRoot)
  const selection = await loadSelection(options.projectRoot)
  const resolved = await loadResolvedRegistry(options.projectRoot)
  const { catalog, path: catalogPath } = await ensureGlobalCatalog()
  const paths = getProjectPaths(options.projectRoot)
  const resolvedSkills = getResolvedSkillIds(config, catalog)
  const skillsProbe = await probeSkills(paths.agentsSkillsDir, resolvedSkills)
  const expectedCodexServers = resolved.serversByTarget.codex.map((server) => server.name)
  const expectedCursorServers = resolved.serversByTarget.cursor.map((server) => server.name)

  const files = {
    '.agents/project.json': await pathExists(paths.agentsProject),
    '.agents/mcp/selection.json': await pathExists(paths.mcpSelection),
    '.agents/mcp/local.json': await pathExists(paths.mcpLocal),
    '.agents/skills/': await pathExists(paths.agentsSkillsDir),
    'AGENTS.md': await pathExists(paths.rootAgentsMd),
    '.codex/config.toml': await pathExists(paths.codexConfig),
    '.gemini/settings.json': await pathExists(paths.geminiSettings),
    '.vscode/mcp.json': await pathExists(paths.vscodeMcp),
    '.cursor/mcp.json': await pathExists(paths.cursorMcp),
    '.antigravity/mcp.json': await pathExists(paths.antigravityProjectMcp),
    '.claude/skills': await pathExists(paths.claudeSkillsBridge),
    '.cursor/skills': await pathExists(paths.cursorSkillsBridge),
    '.agent/skills': await pathExists(paths.antigravitySkillsBridge)
  }

  const probes: Record<string, string> = {}
  if (config.enabledIntegrations.includes('codex')) probes.codex = probeCodex(options.projectRoot, expectedCodexServers)
  if (config.enabledIntegrations.includes('codex')) probes.codex_trust = await probeCodexTrust(options.projectRoot)
  if (config.enabledIntegrations.includes('claude')) probes.claude = probeClaude(options.projectRoot)
  if (config.enabledIntegrations.includes('gemini')) probes.gemini = probeGemini(options.projectRoot)
  if (config.enabledIntegrations.includes('copilot_vscode')) probes.copilot_vscode = await probeCopilot(paths.vscodeMcp)
  if (config.enabledIntegrations.includes('cursor')) probes.cursor = probeCursor(options.projectRoot, expectedCursorServers)
  if (config.enabledIntegrations.includes('antigravity')) probes.antigravity = await probeAntigravity(options.projectRoot)
  probes.skills = skillsProbe

  if (resolved.missingRequiredEnv.length > 0) {
    probes.env = `missing required env: ${resolved.missingRequiredEnv.join('; ')}`
  }

  const output: StatusOutput = {
    projectRoot: path.resolve(options.projectRoot),
    mcpSource: {
      catalog: catalogPath,
      selection: '.agents/mcp/selection.json',
      localOverride: '.agents/mcp/local.json'
    },
    enabledIntegrations: config.enabledIntegrations,
    syncMode: config.syncMode,
    selectedMcpServers: selection.selectedMcpServers,
    selectedSkillPacks: config.selectedSkillPacks,
    selectedSkills: [...new Set([...config.selectedSkills])],
    resolvedSkills,
    files,
    probes
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }

  process.stdout.write(`Project: ${output.projectRoot}\n`)
  process.stdout.write(`MCP source: ${output.mcpSource.catalog} + ${output.mcpSource.selection} + ${output.mcpSource.localOverride}\n`)
  process.stdout.write(`Enabled integrations: ${output.enabledIntegrations.join(', ') || '(none)'}\n`)
  process.stdout.write(`Sync mode: ${output.syncMode}\n`)
  process.stdout.write(`Selected MCP: ${output.selectedMcpServers.join(', ') || '(none)'}\n`)
  process.stdout.write(`Selected skill packs: ${output.selectedSkillPacks.join(', ') || '(none)'}\n`)
  process.stdout.write(`Selected skills: ${output.selectedSkills.join(', ') || '(none)'}\n`)
  process.stdout.write(`Resolved skills: ${output.resolvedSkills.join(', ') || '(none)'}\n`)
  process.stdout.write('Files:\n')
  for (const [file, exists] of Object.entries(output.files)) {
    process.stdout.write(`- ${file}: ${exists ? 'ok' : 'missing'}\n`)
  }
  process.stdout.write('Probes:\n')
  for (const [name, result] of Object.entries(output.probes)) {
    process.stdout.write(`- ${name}: ${result}\n`)
  }
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
  const lines = stripAnsi(result.stdout)
    .split('\n')
    .map((line) => line.trim())
  const managedLines = lines.filter((line) => line.startsWith('agents__'))
  const managed = managedLines.length
  const unhealthy = managedLines.filter((line) => line.includes('✗') || line.toLowerCase().includes('failed')).length
  if (unhealthy > 0) {
    return `${managed} managed MCP server(s), ${unhealthy} unhealthy`
  }
  return `${managed} managed MCP server(s) detected`
}

function probeGemini(projectRoot: string): string {
  if (!commandExists('gemini')) return 'gemini CLI not found'
  const result = runCommand('gemini', ['mcp', 'list'], projectRoot)
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  if (output.includes('Invalid configuration')) return 'invalid Gemini config detected'
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const disconnected = lines.filter((line) => line.includes('✗') || line.toLowerCase().includes('disconnected'))
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
  const result = runCommand('cursor-agent', ['mcp', 'list'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`

  const output = stripAnsi(`${result.stdout}\n${result.stderr}`)
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const loaded = lines.filter((line) => line.includes(': ready')).length
  const notApproved = lines.filter((line) => line.includes('needs approval')).length
  const missing = expectedServerNames.filter((name) => !lines.some((line) => line.startsWith(`${name}:`)))

  const parts = [`${loaded} ready`]
  if (notApproved > 0) parts.push(`${notApproved} needs approval`)
  if (missing.length > 0) parts.push(`missing in list: ${missing.join(', ')}`)
  return parts.join(', ')
}

async function probeAntigravity(projectRoot: string): Promise<string> {
  const globalPath = getAntigravityUserMcpPath()
  if (!(await pathExists(globalPath))) return `global MCP file missing (${globalPath})`

  try {
    const parsed = await readJson<{ servers?: Record<string, unknown> }>(globalPath)
    const digest = projectHash(projectRoot)
    const prefix = `agents__${digest}__`
    const managed = Object.keys(parsed.servers ?? {}).filter((name) => name.startsWith(prefix))
    return `${managed.length} managed server(s) in global profile`
  } catch {
    return 'invalid Antigravity global MCP JSON'
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

function getResolvedSkillIds(config: ProjectConfig, catalog: CatalogFile): string[] {
  const selected = new Set<string>()
  for (const packId of config.selectedSkillPacks) {
    const pack = catalog.skillPacks.find((item) => item.id === packId)
    if (!pack) continue
    for (const skillId of pack.skillIds) {
      selected.add(skillId)
    }
  }
  for (const skillId of config.selectedSkills) {
    selected.add(skillId)
  }
  return [...selected].sort((a, b) => a.localeCompare(b))
}

async function probeSkills(skillsDir: string, expectedSkillIds: string[]): Promise<string> {
  if (!(await pathExists(skillsDir))) return 'skills directory missing'

  const existing = await listDirNames(skillsDir)
  const missing = expectedSkillIds.filter((id) => !existing.includes(id))

  if (expectedSkillIds.length === 0) {
    return `${existing.length} skill folder(s) present (no managed selection)`
  }

  if (missing.length === 0) {
    return `${existing.length} skill folder(s) present; managed selection satisfied`
  }

  const parts = [`${existing.length} skill folder(s) found`]
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`)
  return parts.join('; ')
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '')
}

function projectHash(projectRoot: string): string {
  return createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 10)
}
