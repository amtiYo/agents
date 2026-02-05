import { loadAgentsConfig } from '../core/config.js'
import { pathExists } from '../core/fs.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { getProjectPaths } from '../core/paths.js'
import { commandExists, runCommand } from '../core/shell.js'
import { performSync } from '../core/sync.js'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../core/trust.js'
import { validateSkillsDirectory } from '../core/skillsValidation.js'
import { validateVscodeSettingsParse } from '../core/vscodeSettings.js'
import { INTEGRATIONS } from '../integrations/registry.js'
import { listMcpEntries, loadMcpState } from '../core/mcpCrud.js'
import { isPlaceholderValue, isSecretLikeKey } from '../core/mcpSecrets.js'

export interface DoctorOptions {
  projectRoot: string
  fix: boolean
}

interface Issue {
  level: 'error' | 'warning'
  message: string
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const paths = getProjectPaths(options.projectRoot)
  const issues: Issue[] = []

  if (!(await pathExists(paths.agentsConfig))) {
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
    }
  } catch (error) {
    issues.push({
      level: 'warning',
      message: error instanceof Error ? `Failed to inspect MCP configs: ${error.message}` : 'Failed to inspect MCP configs'
    })
  }

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
  if (codexEnabled) {
    const codexTrust = await getCodexTrustState(options.projectRoot)
    if (codexTrust !== 'trusted' && !options.fix) {
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
    if (!options.fix) {
      issues.push({
        level: 'warning',
        message: `"${candidate}" is tracked by git. Ignore rules do not affect tracked files; use "git rm --cached ${candidate}" if needed.`
      })
    }
  }

  if (options.fix) {
    for (const trackedPath of trackedByGit) {
      const removed = untrackGitPath(options.projectRoot, trackedPath)
      if (!removed) {
        issues.push({ level: 'warning', message: `Failed to untrack "${trackedPath}" automatically.` })
      }
    }
    if (codexEnabled) {
      try {
        await ensureCodexProjectTrusted(options.projectRoot)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push({ level: 'warning', message: `Failed to set Codex trust automatically: ${message}` })
      }
    }
    await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
  }

  if (config.integrations.enabled.includes('antigravity') && !(await pathExists(paths.antigravityProjectMcp)) && !options.fix) {
    issues.push({
      level: 'warning',
      message: 'Antigravity project MCP file missing: .antigravity/mcp.json (run agents sync).'
    })
  }

  report(issues)

  const hasErrors = issues.some((issue) => issue.level === 'error')
  if (hasErrors) {
    process.exitCode = 1
  }
}

function report(issues: Issue[]): void {
  if (issues.length === 0) {
    process.stdout.write('Doctor: no issues found.\n')
    return
  }

  process.stdout.write('Doctor report:\n')
  for (const issue of issues) {
    process.stdout.write(`- [${issue.level}] ${issue.message}\n`)
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

function extractPlaceholders(value: string | undefined): string[] {
  if (!value) return []
  const out = new Set<string>()
  for (const match of value.matchAll(/\$\{([A-Z0-9_]+)\}/g)) {
    if (match[1]) out.add(match[1])
  }
  return [...out]
}
