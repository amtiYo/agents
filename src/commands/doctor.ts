import TOML from '@iarna/toml'
import { loadAgentsConfig } from '../core/config.js'
import { pathExists, readJson, readTextOrEmpty } from '../core/fs.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { getProjectPaths } from '../core/paths.js'
import type { ProjectPaths } from '../core/paths.js'
import { commandExists, runCommand } from '../core/shell.js'
import { performSync } from '../core/sync.js'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../core/trust.js'
import { validateSkillsDirectory } from '../core/skillsValidation.js'
import { validateVscodeSettingsParse } from '../core/vscodeSettings.js'
import { INTEGRATIONS } from '../integrations/registry.js'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import { isPlaceholderValue, isSecretLikeKey } from '../core/mcpSecrets.js'
import { validateEnvKey, validateHeaderKey } from '../core/mcpValidation.js'
import * as ui from '../core/ui.js'
import type { IntegrationName } from '../types.js'

export interface DoctorOptions {
  projectRoot: string
  fix: boolean
  fixDryRun?: boolean
}

interface Issue {
  level: 'error' | 'warning'
  message: string
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  if (options.fix && options.fixDryRun) {
    throw new Error('Use either --fix or --fix-dry-run, not both.')
  }

  const applyFixes = options.fix === true
  const previewFixes = options.fixDryRun === true

  const paths = getProjectPaths(options.projectRoot)
  const issues: Issue[] = []
  const actions: string[] = []

  const spin = ui.spinner()
  spin.start('Running diagnostics...')

  if (!(await pathExists(paths.agentsConfig))) {
    spin.stop('Diagnostics complete')
    issues.push({ level: 'error', message: 'Missing .agents/agents.json (run agents start)' })
    report(issues)
    process.exitCode = 1
    return
  }

  if (!(await pathExists(paths.agentsLocal))) {
    issues.push({ level: 'warning', message: 'Missing .agents/local.json (run agents start or create manually)' })
  }

  if (!(await pathExists(paths.rootAgentsMd))) {
    issues.push({ level: 'error', message: 'Missing root AGENTS.md' })
  }

  let config
  try {
    config = await loadAgentsConfig(options.projectRoot)
  } catch (error) {
    spin.stop('Diagnostics complete')
    issues.push({ level: 'error', message: error instanceof Error ? error.message : String(error) })
    report(issues)
    process.exitCode = 1
    return
  }

  try {
    const resolved = await loadResolvedRegistry(options.projectRoot)
    for (const missing of resolved.missingRequiredEnv) {
      issues.push({ level: 'warning', message: `Missing required env: ${missing}` })
    }
    for (const warning of resolved.warnings) {
      issues.push({ level: 'warning', message: warning })
    }
  } catch (error) {
    issues.push({
      level: 'error',
      message: error instanceof Error ? `MCP resolution failed: ${error.message}` : 'MCP resolution failed'
    })
  }

  try {
    const mcpState = await loadMcpState(options.projectRoot)
    const entries = listMcpEntries(mcpState)
    for (const entry of entries) {
      for (const warning of collectPlaceholderWarnings(entry.name, entry.server, entry.localOverride)) {
        issues.push({ level: 'warning', message: warning })
      }
      for (const warning of collectSecretLiteralWarnings(entry.name, entry.server)) {
        issues.push({ level: 'warning', message: warning })
      }
      for (const message of collectInvalidKeyIssues(entry.name, entry.server, entry.localOverride)) {
        issues.push({ level: 'error', message })
      }
    }
  } catch (error) {
    issues.push({
      level: 'warning',
      message: error instanceof Error ? `Failed to inspect MCP configs: ${error.message}` : 'Failed to inspect MCP configs'
    })
  }

  await validateManagedConfigSyntax(paths, config.integrations.enabled, issues)

  const skillWarnings = await validateSkillsDirectory(paths.agentsSkillsDir)
  for (const warning of skillWarnings) {
    issues.push({ level: 'warning', message: warning })
  }

  if (config.workspace.vscode.hideGenerated) {
    const valid = await validateVscodeSettingsParse(paths.vscodeSettings)
    if (!valid) {
      issues.push({
        level: 'warning',
        message: 'VS Code settings are invalid JSONC; .vscode/settings.json cannot be updated while hideGenerated is enabled.'
      })
    }
  }

  for (const integration of INTEGRATIONS) {
    if (!config.integrations.enabled.includes(integration.id)) continue
    if (!integration.requiredBinary) continue
    if (!commandExists(integration.requiredBinary)) {
      issues.push({
        level: 'warning',
        message: `${integration.label} binary "${integration.requiredBinary}" not found in PATH`
      })
    }
  }

  const codexEnabled = config.integrations.enabled.includes('codex')
  let codexTrustNeedsFix = false
  if (codexEnabled) {
    const codexTrust = await getCodexTrustState(options.projectRoot)
    codexTrustNeedsFix = codexTrust !== 'trusted'
    if (codexTrustNeedsFix && !applyFixes && !previewFixes) {
      issues.push({
        level: 'warning',
        message: 'Codex project trust is not set; project .codex/config.toml may be ignored.'
      })
    }
  }

  const trackedChecks = config.syncMode === 'source-only'
    ? [
        '.codex/config.toml',
        '.gemini/settings.json',
        '.vscode/mcp.json',
        '.cursor/mcp.json',
        '.antigravity/mcp.json',
        '.claude/skills',
        '.cursor/skills',
        '.gemini/skills'
      ]
    : []
  trackedChecks.push('.agents/generated', '.agents/local.json')
  const trackedByGit: string[] = []
  for (const candidate of trackedChecks) {
    if (!isGitTracked(options.projectRoot, candidate)) continue
    trackedByGit.push(candidate)
    if (!applyFixes && !previewFixes) {
      issues.push({
        level: 'warning',
        message: `"${candidate}" is tracked by git. Ignore rules do not affect tracked files; use "git rm --cached ${candidate}" if needed.`
      })
    }
  }

  spin.stop('Diagnostics complete')

  if (previewFixes) {
    if (trackedByGit.length > 0) {
      actions.push(`Would untrack git paths: ${trackedByGit.join(', ')}`)
    }
    if (codexEnabled && codexTrustNeedsFix) {
      actions.push('Would set Codex project trust for this repo.')
    }
    actions.push('Would run agents sync after fixes.')
  }

  if (applyFixes) {
    const fixSpin = ui.spinner()
    fixSpin.start('Applying fixes...')

    for (const trackedPath of trackedByGit) {
      const removed = untrackGitPath(options.projectRoot, trackedPath)
      if (!removed) {
        issues.push({ level: 'warning', message: `Failed to untrack "${trackedPath}" automatically.` })
      } else {
        actions.push(`Untracked "${trackedPath}" from git index.`)
      }
    }
    if (codexEnabled && codexTrustNeedsFix) {
      try {
        await ensureCodexProjectTrusted(options.projectRoot)
        actions.push('Set Codex project trust.')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push({ level: 'warning', message: `Failed to set Codex trust automatically: ${message}` })
      }
    }
    await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
    actions.push('Ran agents sync.')

    fixSpin.stop('Fixes applied')
  }

  if (config.integrations.enabled.includes('antigravity') && !(await pathExists(paths.antigravityProjectMcp)) && !applyFixes) {
    issues.push({
      level: 'warning',
      message: 'Antigravity project MCP file missing: .antigravity/mcp.json (run agents sync).'
    })
  }

  report(issues)
  reportActions(actions, previewFixes, applyFixes)
  reportNextSteps(issues, previewFixes, applyFixes)

  const hasErrors = issues.some((issue) => issue.level === 'error')
  if (hasErrors) {
    process.exitCode = 1
  }
}

function report(issues: Issue[]): void {
  if (issues.length === 0) {
    ui.success('Doctor: no issues found')
    return
  }

  ui.blank()
  for (const issue of issues) {
    if (issue.level === 'error') {
      ui.error(issue.message)
    } else {
      ui.warning(issue.message)
    }
  }
  ui.blank()
}

function reportActions(actions: string[], previewFixes: boolean, applyFixes: boolean): void {
  if (actions.length === 0) return

  if (previewFixes) {
    ui.writeln('Dry-run (would apply):')
  } else if (applyFixes) {
    ui.writeln('Applied fixes:')
  } else {
    return
  }

  ui.arrowList(actions)
  ui.blank()
}

function reportNextSteps(issues: Issue[], previewFixes: boolean, applyFixes: boolean): void {
  const hasErrors = issues.some((issue) => issue.level === 'error')
  const hasWarnings = issues.some((issue) => issue.level === 'warning')

  if (hasErrors) {
    ui.nextSteps('resolve errors and rerun "agents doctor".')
    return
  }

  if (applyFixes) {
    ui.nextSteps('run "agents status --verbose" to verify runtime state.')
    return
  }

  if (previewFixes) {
    ui.nextSteps('run "agents doctor --fix" to apply these changes.')
    return
  }

  if (hasWarnings) {
    ui.nextSteps('run "agents doctor --fix-dry-run" to preview automatic fixes.')
  }
}

function isGitTracked(projectRoot: string, relativePath: string): boolean {
  if (!commandExists('git')) return false
  const result = runCommand('git', ['ls-files', '--error-unmatch', relativePath], projectRoot)
  return result.ok
}

function untrackGitPath(projectRoot: string, relativePath: string): boolean {
  if (!commandExists('git')) return false
  const result = runCommand('git', ['rm', '--cached', '-r', '--', relativePath], projectRoot)
  return result.ok
}

function collectPlaceholderWarnings(
  name: string,
  server: {
    command?: string
    url?: string
    cwd?: string
    args?: string[]
    env?: Record<string, string>
    headers?: Record<string, string>
  },
  localOverride: {
    command?: string
    url?: string
    cwd?: string
    args?: string[]
    env?: Record<string, string>
    headers?: Record<string, string>
  } | undefined,
): string[] {
  const warnings: string[] = []

  for (const placeholder of extractPlaceholders(server.command)) {
    if (placeholder === 'PROJECT_ROOT') continue
    if (localOverride?.command !== undefined) continue
    if (!process.env[placeholder]) {
      warnings.push(`MCP server "${name}" has unresolved placeholder in command: \${${placeholder}}`)
    }
  }
  for (const placeholder of extractPlaceholders(server.url)) {
    if (placeholder === 'PROJECT_ROOT') continue
    if (localOverride?.url !== undefined) continue
    if (!process.env[placeholder]) {
      warnings.push(`MCP server "${name}" has unresolved placeholder in url: \${${placeholder}}`)
    }
  }
  for (const placeholder of extractPlaceholders(server.cwd)) {
    if (placeholder === 'PROJECT_ROOT') continue
    if (localOverride?.cwd !== undefined) continue
    if (!process.env[placeholder]) {
      warnings.push(`MCP server "${name}" has unresolved placeholder in cwd: \${${placeholder}}`)
    }
  }

  if (!localOverride?.args) {
    for (const arg of server.args ?? []) {
      for (const placeholder of extractPlaceholders(arg)) {
        if (placeholder === 'PROJECT_ROOT') continue
        if (!process.env[placeholder]) {
          warnings.push(`MCP server "${name}" has unresolved placeholder in args: \${${placeholder}}`)
        }
      }
    }
  }

  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (localOverride?.env && key in localOverride.env) continue
    for (const placeholder of extractPlaceholders(value)) {
      if (placeholder === 'PROJECT_ROOT') continue
      if (!process.env[placeholder]) {
        warnings.push(`MCP server "${name}" has unresolved placeholder in env "${key}": \${${placeholder}}`)
      }
    }
  }

  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (localOverride?.headers && key in localOverride.headers) continue
    for (const placeholder of extractPlaceholders(value)) {
      if (placeholder === 'PROJECT_ROOT') continue
      if (!process.env[placeholder]) {
        warnings.push(`MCP server "${name}" has unresolved placeholder in header "${key}": \${${placeholder}}`)
      }
    }
  }

  return warnings
}

function collectSecretLiteralWarnings(
  name: string,
  server: {
    env?: Record<string, string>
    headers?: Record<string, string>
    args?: string[]
  },
): string[] {
  const warnings: string[] = []

  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (!isSecretLikeKey(key)) continue
    if (isPlaceholderValue(value)) continue
    warnings.push(`MCP server "${name}" may contain a secret literal in env "${key}". Move it to .agents/local.json.`)
  }

  for (const [key, value] of Object.entries(server.headers ?? {})) {
    if (!isSecretLikeKey(key)) continue
    if (isPlaceholderValue(value)) continue
    warnings.push(`MCP server "${name}" may contain a secret literal in header "${key}". Move it to .agents/local.json.`)
  }

  const args = server.args ?? []
  for (let i = 0; i < args.length - 1; i += 1) {
    const arg = args[i]
    if (!/^--?(api[-_]?key|token|secret|password|passphrase|auth|authorization)$/i.test(arg)) continue
    const candidate = args[i + 1]
    if (candidate.startsWith('-')) continue
    if (isPlaceholderValue(candidate)) continue
    warnings.push(`MCP server "${name}" may contain a secret literal in args near "${arg}". Move it to .agents/local.json.`)
  }

  return warnings
}

function collectInvalidKeyIssues(
  name: string,
  server: {
    env?: Record<string, string>
    headers?: Record<string, string>
  },
  localOverride: {
    env?: Record<string, string>
    headers?: Record<string, string>
  } | undefined,
): string[] {
  const messages: string[] = []
  messages.push(...collectInvalidKeyIssuesForSource(name, server, '.agents/agents.json'))
  if (localOverride) {
    messages.push(...collectInvalidKeyIssuesForSource(name, localOverride, '.agents/local.json'))
  }
  return messages
}

function collectInvalidKeyIssuesForSource(
  name: string,
  server: {
    env?: Record<string, string>
    headers?: Record<string, string>
  },
  source: string,
): string[] {
  const messages: string[] = []

  for (const key of Object.keys(server.env ?? {})) {
    try {
      validateEnvKey(key)
    } catch (error) {
      messages.push(
        `MCP server "${name}" has invalid environment variable key "${key}" in ${source}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  for (const key of Object.keys(server.headers ?? {})) {
    try {
      validateHeaderKey(key)
    } catch (error) {
      messages.push(
        `MCP server "${name}" has invalid header key "${key}" in ${source}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return messages
}

async function validateManagedConfigSyntax(
  paths: ProjectPaths,
  enabledIntegrations: IntegrationName[],
  issues: Issue[],
): Promise<void> {
  await validateTomlIfExists(paths.generatedCodex, '.agents/generated/codex.config.toml', issues)
  await validateJsonIfExists(paths.generatedGemini, '.agents/generated/gemini.settings.json', issues)
  await validateJsonIfExists(paths.generatedCopilot, '.agents/generated/copilot.vscode.mcp.json', issues)
  await validateJsonIfExists(paths.generatedCursor, '.agents/generated/cursor.mcp.json', issues)
  await validateJsonIfExists(paths.generatedAntigravity, '.agents/generated/antigravity.mcp.json', issues)
  await validateJsonIfExists(paths.generatedClaude, '.agents/generated/claude.mcp.json', issues)

  if (enabledIntegrations.includes('codex')) {
    await validateTomlIfExists(paths.codexConfig, '.codex/config.toml', issues)
  }
  if (enabledIntegrations.includes('gemini')) {
    await validateJsonIfExists(paths.geminiSettings, '.gemini/settings.json', issues)
  }
  if (enabledIntegrations.includes('copilot_vscode')) {
    await validateJsonIfExists(paths.vscodeMcp, '.vscode/mcp.json', issues)
  }
  if (enabledIntegrations.includes('cursor')) {
    await validateJsonIfExists(paths.cursorMcp, '.cursor/mcp.json', issues)
  }
  if (enabledIntegrations.includes('antigravity')) {
    await validateJsonIfExists(paths.antigravityProjectMcp, '.antigravity/mcp.json', issues)
  }
}

async function validateTomlIfExists(filePath: string, label: string, issues: Issue[]): Promise<void> {
  if (!(await pathExists(filePath))) return
  const raw = await readTextOrEmpty(filePath)
  try {
    TOML.parse(raw)
  } catch (error) {
    issues.push({
      level: 'error',
      message: `Invalid TOML in ${label}: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}

async function validateJsonIfExists(filePath: string, label: string, issues: Issue[]): Promise<void> {
  if (!(await pathExists(filePath))) return
  try {
    await readJson<unknown>(filePath)
  } catch (error) {
    issues.push({
      level: 'error',
      message: `Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`
    })
  }
}

function extractPlaceholders(value: string | undefined): string[] {
  if (!value) return []
  const out = new Set<string>()
  for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    if (match[1]) out.add(match[1])
  }
  return [...out]
}
