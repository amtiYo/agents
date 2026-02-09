import path from 'node:path'
import { listMcpEntries, loadMcpState, type McpServerEntry } from '../core/mcpCrud.js'
import { commandExists, runCommand } from '../core/shell.js'
import { listCursorMcpStatuses, type CursorServerState } from '../core/cursorCli.js'
import { toManagedClaudeName } from '../integrations/claude.js'
import * as ui from '../core/ui.js'
import type { IntegrationName, McpServerDefinition } from '../types.js'

const ALL_INTEGRATIONS: IntegrationName[] = [
  'codex',
  'claude',
  'gemini',
  'copilot_vscode',
  'cursor',
  'antigravity'
]

const DEFAULT_RUNTIME_TIMEOUT_MS = 8000

export interface McpTestOptions {
  projectRoot: string
  name?: string
  json: boolean
  runtime?: boolean
  runtimeTimeoutMs?: number
}

interface ServerTestResult {
  name: string
  status: 'ok' | 'error'
  messages: string[]
  runtime?: Partial<Record<IntegrationName, RuntimeIntegrationResult>>
}

interface RuntimeIntegrationResult {
  status: 'ok' | 'error' | 'unsupported' | 'unavailable' | 'unknown'
  message: string
}

interface RuntimeSummary {
  enabled: boolean
  timeoutMs: number
  availableIntegrations: IntegrationName[]
  errors: number
}

interface RuntimeCheckResult {
  perServer: Record<string, Partial<Record<IntegrationName, RuntimeIntegrationResult>>>
  availableIntegrations: IntegrationName[]
  errors: number
}

interface RuntimeProbe<T> {
  available: boolean
  detail: string
  data?: T
}

type ClaudeRuntimeStatus = 'ok' | 'error' | 'unknown'
type GeminiRuntimeStatus = 'ok' | 'error' | 'unknown'

export async function runMcpTest(options: McpTestOptions): Promise<void> {
  ui.setContext({ json: options.json })

  const state = await loadMcpState(options.projectRoot)
  const entries = listMcpEntries(state)
  const filtered = options.name
    ? entries.filter((entry) => entry.name === options.name)
    : entries

  if (options.name && filtered.length === 0) {
    throw new Error(`MCP server "${options.name}" does not exist.`)
  }

  const runtimeEnabled = options.runtime === true
  const runtimeTimeoutMs = options.runtimeTimeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS

  const spin = ui.spinner()
  if (runtimeEnabled) {
    spin.start('Running runtime checks...')
  }

  const runtime = runtimeEnabled
    ? runRuntimeChecks(filtered, options.projectRoot, runtimeTimeoutMs)
    : null

  if (runtimeEnabled) {
    spin.stop('Runtime checks complete')
  }

  const results: ServerTestResult[] = filtered.map((entry) => {
    const tested = testServer(entry.name, entry.mergedServer)
    if (runtimeEnabled && runtime) {
      tested.runtime = runtime.perServer[entry.name] ?? {}
    }
    return tested
  })

  const staticErrors = results.filter((result) => result.status === 'error').length
  const runtimeErrors = runtime?.errors ?? 0
  const totalErrors = runtimeEnabled ? staticErrors + runtimeErrors : staticErrors

  const payload: {
    projectRoot: string
    tested: number
    errors: number
    results: ServerTestResult[]
    runtime?: RuntimeSummary
  } = {
    projectRoot: path.resolve(options.projectRoot),
    tested: results.length,
    errors: totalErrors,
    results
  }

  if (runtimeEnabled && runtime) {
    payload.runtime = {
      enabled: true,
      timeoutMs: runtimeTimeoutMs,
      availableIntegrations: runtime.availableIntegrations,
      errors: runtime.errors
    }
  }

  if (options.json) {
    ui.json(payload)
    if (totalErrors > 0) {
      process.exitCode = 1
    }
    return
  }

  if (results.length === 0) {
    ui.dim('No MCP servers configured.')
    return
  }

  ui.writeln(`MCP test results (${results.length}):`)
  ui.blank()

  for (const result of results) {
    // Status icon and name
    if (result.status === 'ok') {
      ui.success(result.name)
    } else {
      ui.error(result.name)
    }

    // Messages
    for (const message of result.messages) {
      if (message === 'ok') continue
      ui.writeln(`    ${ui.color.dim(message)}`)
    }

    // Runtime results
    if (runtimeEnabled && result.runtime) {
      for (const integration of Object.keys(result.runtime).sort()) {
        const typed = integration as IntegrationName
        const runtimeResult = result.runtime[typed]
        if (!runtimeResult) continue

        const statusIcon = runtimeResult.status === 'ok'
          ? ui.color.green(ui.symbols.success)
          : runtimeResult.status === 'error'
            ? ui.color.red(ui.symbols.error)
            : ui.color.dim(ui.symbols.info)

        ui.writeln(`    ${statusIcon} ${typed}: ${ui.color.dim(runtimeResult.message)}`)
      }
    }
  }

  if (runtimeEnabled && payload.runtime) {
    ui.blank()
    ui.info(
      `Runtime: ${payload.runtime.availableIntegrations.length} integration(s) available, ${payload.runtime.errors} error(s)`
    )
  }

  if (totalErrors > 0) {
    process.exitCode = 1
  }
}

function testServer(name: string, server: McpServerDefinition): ServerTestResult {
  const messages: string[] = []

  if (server.enabled === false) {
    return {
      name,
      status: 'ok',
      messages: ['disabled']
    }
  }

  const missingEnv = (server.requiredEnv ?? []).filter((entry) => !process.env[entry])
  if (missingEnv.length > 0) {
    messages.push(`missing required env: ${missingEnv.join(', ')}`)
  }

  if (server.transport === 'stdio') {
    if (!server.command) {
      messages.push('missing command')
    } else if (!commandExists(server.command)) {
      messages.push(`command not found in PATH: ${server.command}`)
    }
  } else {
    if (!server.url) {
      messages.push('missing url')
    } else if (!isValidHttpUrl(server.url)) {
      messages.push(`invalid URL: ${server.url}`)
    }
  }

  const status: 'ok' | 'error' = messages.length > 0 ? 'error' : 'ok'
  return {
    name,
    status,
    messages: messages.length > 0 ? messages : ['ok']
  }
}

function runRuntimeChecks(entries: McpServerEntry[], projectRoot: string, timeoutMs: number): RuntimeCheckResult {
  const claudeProbe = probeClaude(projectRoot, timeoutMs)
  const geminiProbe = probeGemini(projectRoot, timeoutMs)
  const cursorProbe = probeCursor(projectRoot, timeoutMs)

  const availableIntegrations: IntegrationName[] = []
  if (claudeProbe.available) availableIntegrations.push('claude')
  if (geminiProbe.available) availableIntegrations.push('gemini')
  if (cursorProbe.available) availableIntegrations.push('cursor')

  const perServer: Record<string, Partial<Record<IntegrationName, RuntimeIntegrationResult>>> = {}
  let errors = 0

  for (const entry of entries) {
    const targets = resolveTargets(entry.server)
    const runtimeByIntegration: Partial<Record<IntegrationName, RuntimeIntegrationResult>> = {}

    for (const integration of targets) {
      if (integration === 'codex' || integration === 'copilot_vscode' || integration === 'antigravity') {
        runtimeByIntegration[integration] = {
          status: 'unsupported',
          message: 'Runtime health introspection is not supported for this integration.'
        }
        continue
      }

      if (integration === 'claude') {
        runtimeByIntegration.claude = checkClaudeServer(entry.name, claudeProbe)
        if (claudeProbe.available && runtimeByIntegration.claude.status === 'error') errors += 1
        continue
      }

      if (integration === 'gemini') {
        runtimeByIntegration.gemini = checkGeminiServer(entry.name, geminiProbe)
        if (geminiProbe.available && runtimeByIntegration.gemini.status === 'error') errors += 1
        continue
      }

      if (integration === 'cursor') {
        runtimeByIntegration.cursor = checkCursorServer(entry.name, cursorProbe)
        if (cursorProbe.available && runtimeByIntegration.cursor.status === 'error') errors += 1
      }
    }

    perServer[entry.name] = runtimeByIntegration
  }

  return {
    perServer,
    availableIntegrations,
    errors
  }
}

function checkClaudeServer(name: string, probe: RuntimeProbe<Record<string, ClaudeRuntimeStatus>>): RuntimeIntegrationResult {
  if (!probe.available || !probe.data) {
    return {
      status: 'unavailable',
      message: probe.detail
    }
  }
  const managed = toManagedClaudeName(name)
  const status = probe.data[managed]
  if (status === 'ok') {
    return {
      status: 'ok',
      message: 'Connected'
    }
  }
  if (status === 'error') {
    return {
      status: 'error',
      message: 'Failed/Disconnected'
    }
  }
  if (status === 'unknown') {
    return {
      status: 'unknown',
      message: 'Unknown runtime state'
    }
  }
  return {
    status: 'error',
    message: `Missing from claude mcp list as ${managed}`
  }
}

function checkGeminiServer(name: string, probe: RuntimeProbe<Record<string, GeminiRuntimeStatus>>): RuntimeIntegrationResult {
  if (!probe.available || !probe.data) {
    return {
      status: 'unavailable',
      message: probe.detail
    }
  }
  const status = probe.data[name]
  if (status === 'ok') {
    return {
      status: 'ok',
      message: 'Connected'
    }
  }
  if (status === 'error') {
    return {
      status: 'error',
      message: 'Disconnected/Failed'
    }
  }
  if (status === 'unknown') {
    return {
      status: 'unknown',
      message: 'Unknown runtime state'
    }
  }
  return {
    status: 'error',
    message: `Missing from gemini mcp list as ${name}`
  }
}

function checkCursorServer(name: string, probe: RuntimeProbe<Record<string, CursorServerState>>): RuntimeIntegrationResult {
  if (!probe.available || !probe.data) {
    return {
      status: 'unavailable',
      message: probe.detail
    }
  }
  const status = probe.data[name]
  if (status === undefined) {
    return {
      status: 'error',
      message: `Missing from cursor mcp list as ${name}`
    }
  }
  if (status === 'ready') {
    return {
      status: 'ok',
      message: 'Ready'
    }
  }
  if (status === 'needs-approval') {
    return {
      status: 'error',
      message: 'Needs approval'
    }
  }
  if (status === 'disabled') {
    return {
      status: 'error',
      message: 'Disabled'
    }
  }
  if (status === 'error') {
    return {
      status: 'error',
      message: 'Connection failed'
    }
  }
  return {
    status: 'unknown',
    message: 'Unknown runtime state'
  }
}

function probeClaude(projectRoot: string, timeoutMs: number): RuntimeProbe<Record<string, ClaudeRuntimeStatus>> {
  if (!commandExists('claude')) {
    return {
      available: false,
      detail: 'claude CLI not found'
    }
  }
  const result = runCommand('claude', ['mcp', 'list'], projectRoot, timeoutMs)
  if (!result.ok) {
    return {
      available: false,
      detail: compact(result.stderr) || 'claude mcp list failed'
    }
  }
  return {
    available: true,
    detail: 'ok',
    data: parseClaudeRuntimeStatuses(`${result.stdout}\n${result.stderr}`)
  }
}

function probeGemini(projectRoot: string, timeoutMs: number): RuntimeProbe<Record<string, GeminiRuntimeStatus>> {
  if (!commandExists('gemini')) {
    return {
      available: false,
      detail: 'gemini CLI not found'
    }
  }
  const result = runCommand('gemini', ['mcp', 'list'], projectRoot, timeoutMs)
  if (!result.ok) {
    return {
      available: false,
      detail: compact(result.stderr) || 'gemini mcp list failed'
    }
  }
  return {
    available: true,
    detail: 'ok',
    data: parseGeminiRuntimeStatuses(`${result.stdout}\n${result.stderr}`)
  }
}

function probeCursor(projectRoot: string, timeoutMs: number): RuntimeProbe<Record<string, CursorServerState>> {
  if (!commandExists('cursor-agent')) {
    return {
      available: false,
      detail: 'cursor-agent CLI not found'
    }
  }
  const listed = listCursorMcpStatuses(projectRoot, timeoutMs)
  if (!listed.ok) {
    return {
      available: false,
      detail: compact(listed.stderr) || 'cursor-agent mcp list failed'
    }
  }
  return {
    available: true,
    detail: 'ok',
    data: listed.statuses
  }
}

function parseClaudeRuntimeStatuses(output: string): Record<string, ClaudeRuntimeStatus> {
  const statuses: Record<string, ClaudeRuntimeStatus> = {}
  const lines = output
    .split('\n')
    .map((line) => line.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '').trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9._:-]+):\s*(.+)$/)
    if (!match?.[1] || !match[2]) continue
    const name = match[1]
    const detail = match[2].toLowerCase()
    if (detail.includes('\u2717') || detail.includes('failed') || detail.includes('disconnected') || detail.includes('error')) {
      statuses[name] = 'error'
      continue
    }
    if (detail.includes('\u2713') || detail.includes('connected')) {
      statuses[name] = 'ok'
      continue
    }
    statuses[name] = 'unknown'
  }

  return statuses
}

function parseGeminiRuntimeStatuses(output: string): Record<string, GeminiRuntimeStatus> {
  const statuses: Record<string, GeminiRuntimeStatus> = {}
  const lines = output
    .split('\n')
    .map((line) => line.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, '').trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^(?:[\u2713\u2717]\s*)?([a-zA-Z0-9._:-]+):\s*(.+)$/)
    if (!match?.[1] || !match[2]) continue
    const name = match[1]
    const detail = match[2].toLowerCase()
    if (line.includes('\u2717') || detail.includes('disconnected') || detail.includes('failed') || detail.includes('error')) {
      statuses[name] = 'error'
      continue
    }
    if (line.includes('\u2713') || detail.includes('connected')) {
      statuses[name] = 'ok'
      continue
    }
    statuses[name] = 'unknown'
  }

  return statuses
}

function resolveTargets(server: McpServerDefinition): IntegrationName[] {
  if (!server.targets || server.targets.length === 0) {
    return ALL_INTEGRATIONS
  }
  return [...new Set(server.targets)]
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function compact(input: string): string {
  return input.trim().split('\n').at(-1) ?? ''
}
