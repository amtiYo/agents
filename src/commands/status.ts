import path from 'node:path'
import { loadConfig } from '../core/config.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists, readJson } from '../core/fs.js'
import { commandExists, runCommand } from '../core/shell.js'

export interface StatusOptions {
  projectRoot: string
  json: boolean
}

interface StatusOutput {
  projectRoot: string
  enabledIntegrations: string[]
  files: Record<string, boolean>
  probes: Record<string, string>
}

export async function runStatus(options: StatusOptions): Promise<void> {
  const config = await loadConfig(options.projectRoot)
  const paths = getProjectPaths(options.projectRoot)

  const files = {
    '.agents/config.json': await pathExists(paths.agentsConfig),
    'AGENTS.md': await pathExists(paths.rootAgentsMd),
    '.codex/config.toml': await pathExists(paths.codexConfig),
    '.gemini/settings.json': await pathExists(paths.geminiSettings),
    '.vscode/mcp.json': await pathExists(paths.vscodeMcp)
  }

  const probes: Record<string, string> = {}

  if (config.enabledIntegrations.includes('codex')) {
    probes.codex = probeCodex(options.projectRoot)
  }
  if (config.enabledIntegrations.includes('claude')) {
    probes.claude = probeClaude(options.projectRoot)
  }
  if (config.enabledIntegrations.includes('gemini')) {
    probes.gemini = probeGemini(options.projectRoot)
  }
  if (config.enabledIntegrations.includes('copilot_vscode')) {
    probes.copilot_vscode = await probeCopilot(paths.vscodeMcp)
  }

  const out: StatusOutput = {
    projectRoot: path.resolve(options.projectRoot),
    enabledIntegrations: config.enabledIntegrations,
    files,
    probes
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    return
  }

  process.stdout.write(`Project: ${out.projectRoot}\n`)
  process.stdout.write(`Enabled integrations: ${out.enabledIntegrations.join(', ') || '(none)'}\n`)
  process.stdout.write('Files:\n')
  for (const [file, exists] of Object.entries(out.files)) {
    process.stdout.write(`- ${file}: ${exists ? 'ok' : 'missing'}\n`)
  }
  process.stdout.write('Probes:\n')
  for (const [name, status] of Object.entries(out.probes)) {
    process.stdout.write(`- ${name}: ${status}\n`)
  }
}

function probeCodex(projectRoot: string): string {
  if (!commandExists('codex')) return 'codex CLI not found'
  const result = runCommand('codex', ['mcp', 'list', '--json'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  try {
    const parsed = JSON.parse(result.stdout) as Array<unknown>
    return `${parsed.length} MCP server(s) visible`
  } catch {
    return 'ok (unparsed output)'
  }
}

function probeClaude(projectRoot: string): string {
  if (!commandExists('claude')) return 'claude CLI not found'
  const result = runCommand('claude', ['mcp', 'list'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`
  const managed = result.stdout
    .split('\n')
    .filter((line) => line.trim().startsWith('agents__')).length
  return `${managed} managed MCP server(s) detected`
}

function probeGemini(projectRoot: string): string {
  if (!commandExists('gemini')) return 'gemini CLI not found'
  const result = runCommand('gemini', ['mcp', 'list'], projectRoot)
  if (!result.ok) return `failed (${compact(result.stderr)})`
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

function compact(input: string): string {
  return input.trim().split('\n').at(-1) ?? 'unknown'
}
