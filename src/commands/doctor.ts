import path from 'node:path'
import TOML from '@iarna/toml'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import YAML from 'yaml'
import { loadAgentsConfig } from '../core/config.js'
import { getClaudeInstructionsHealth } from '../core/claudeInstructions.js'
import {
  getClaudeDesktopConfigPath,
  getClaudeDesktopConfigUnavailableDetail
} from '../core/claudeDesktop.js'
import { pathExists, readJson, readTextOrEmpty } from '../core/fs.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { getProjectPaths, toHomeRelativePath } from '../core/paths.js'
import type { ProjectPaths } from '../core/paths.js'
import type { CopilotCliPath } from '../types.js'
import { getWindsurfGlobalMcpPath } from '../core/windsurf.js'
import { commandExists, runCommand } from '../core/shell.js'
import { performSync } from '../core/sync.js'
import {
  ensureCodexProjectTrusted,
  ensureGrokProjectTrusted,
  getCodexTrustState,
  getGrokTrustState,
  getGrokTrustedFoldersPath,
  inspectCodexGlobalConfig
} from '../core/trust.js'
import { SKILL_BRIDGES, inspectAntigravitySkillsBridge } from '../core/skills.js'
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

/**
 * Run diagnostics for a project and optionally preview or apply automatic fixes.
 *
 * Performs filesystem and configuration checks, collects errors and warnings, validates generated
 * and managed configs, inspects MCP state and integrations, and reports issues/actions. When
 * requested, it will preview proposed fixes or apply them (untracking git paths, setting Codex
 * trust, and running `agents sync`).
 *
 * @param options - Doctor command options (must include `projectRoot`; may include `fix` and `fixDryRun` to control applying or previewing fixes)
 * @throws Error - If both `options.fix` and `options.fixDryRun` are enabled simultaneously
 */
export async function runDoctor(options: DoctorOptions): Promise<void> {
  if (options.fix && options.fixDryRun) {
    throw new Error('Use either --fix or --fix-dry-run, not both.')
  }

  const applyFixes = options.fix === true
  const previewFixes = options.fixDryRun === true

  const paths = getProjectPaths(options.projectRoot)
  const claudeDesktopConfigPath = getClaudeDesktopConfigPath()
  const windsurfGlobalMcpPath = getWindsurfGlobalMcpPath()
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
  const antigravityMcpSyncEnabled = config.integrations.options.antigravityGlobalSync !== false
  const enabledForMaterialization = antigravityMcpSyncEnabled
    ? config.integrations.enabled
    : config.integrations.enabled.filter((integration) => integration !== 'antigravity')

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
      if (entry.server.transport === 'sse') {
        issues.push({
          level: 'warning',
          message: `MCP server "${entry.name}" uses the sse transport, deprecated by the MCP 2026-07-28 specification. Switch it to http when the server supports streamable HTTP.`
        })
      }
    }
  } catch (error) {
    issues.push({
      level: 'warning',
      message: error instanceof Error ? `Failed to inspect MCP configs: ${error.message}` : 'Failed to inspect MCP configs'
    })
  }

  await validateManagedConfigSyntax(
    paths,
    enabledForMaterialization,
    claudeDesktopConfigPath,
    windsurfGlobalMcpPath,
    issues,
    { copilotCliPath: config.integrations.options.copilotCliPath },
  )

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
  let grokTrustNeedsFix = false
  if (codexEnabled) {
    const codexGlobal = await inspectCodexGlobalConfig()
    if (!codexGlobal.ok) {
      issues.push({
        level: 'error',
        message: `Codex global config at ${codexGlobal.path} cannot be parsed (${codexGlobal.error ?? 'unknown error'}). Codex ignores every project until this is fixed.`
      })
    }
    const codexTrust = await getCodexTrustState(options.projectRoot)
    // An unreadable config is reported above; trying to set trust in it would fail.
    codexTrustNeedsFix = codexTrust === 'untrusted'
    if (codexTrustNeedsFix && !applyFixes && !previewFixes) {
      issues.push({
        level: 'warning',
        message: 'Codex project trust is not set; project .codex/config.toml may be ignored.'
      })
    }
  }

  if (config.integrations.enabled.includes('grok')) {
    const grokTrust = await getGrokTrustState(options.projectRoot)
    if (grokTrust === 'unreadable') {
      issues.push({
        level: 'error',
        message: `Grok trust file at ${getGrokTrustedFoldersPath()} cannot be parsed. Grok treats every folder as untrusted until this is fixed.`
      })
    }
    grokTrustNeedsFix = grokTrust === 'untrusted'
    if (grokTrustNeedsFix && !applyFixes && !previewFixes) {
      issues.push({
        level: 'warning',
        message:
          'Grok folder trust is not set; Grok ignores this project\'s MCP servers and skills until the folder is trusted.'
      })
    }
  }

  const enabled = new Set(config.integrations.enabled)
  if (enabled.has('claude')) {
    const claudeInstructions = await getClaudeInstructionsHealth(options.projectRoot)
    if (!claudeInstructions.exists && claudeInstructions.hasAgents) {
      issues.push({
        level: 'warning',
        message: 'Claude integration enabled but managed root CLAUDE.md wrapper is missing (run agents sync).'
      })
    } else if (!claudeInstructions.isWrapper && claudeInstructions.managed) {
      issues.push({
        level: 'warning',
        message: 'CLAUDE.md no longer matches the agents-managed wrapper. Run agents sync to reconcile or keep the file custom.'
      })
    } else if (!claudeInstructions.isWrapper && claudeInstructions.exists) {
      issues.push({
        level: 'warning',
        message: 'Custom root CLAUDE.md detected. agents will preserve it and stop managing Claude instructions for this project.'
      })
    }
  }
  if (enabled.has('claude_desktop') && !claudeDesktopConfigPath) {
    issues.push({
      level: 'warning',
      message: getClaudeDesktopConfigUnavailableDetail()
    })
  }
  const trackedChecks = config.syncMode === 'source-only'
    ? [
        ...(enabled.has('claude') ? ['CLAUDE.md'] : []),
        ...(enabled.has('codex') ? ['.codex/config.toml'] : []),
        ...(enabled.has('gemini') ? ['.gemini/settings.json'] : []),
        ...(enabled.has('copilot_vscode') ? ['.vscode/mcp.json'] : []),
        // Only files this CLI adds to .gitignore belong here. Settings files that hold
        // the tool's own configuration (.amp, .kilo, .zed) and .github/mcp.json are
        // deliberately left to the user, so they must never be untracked by --fix.
        ...(enabled.has('copilot_cli') && config.integrations.options.copilotCliPath === '.mcp.json'
          ? ['.mcp.json']
          : []),
        ...(enabled.has('claude') && config.integrations.options.claudeScope === 'project' ? ['.mcp.json'] : []),
        ...(enabled.has('grok') ? ['.grok/config.toml'] : []),
        ...(enabled.has('droid') ? ['.factory/mcp.json'] : []),
        ...(enabled.has('devin') ? ['.devin/mcp_config.json'] : []),
        ...(enabled.has('cursor') ? ['.cursor/mcp.json'] : []),
        ...(enabled.has('cursor') ? ['.cursor/skills'] : []),
        ...(enabled.has('windsurf') ? ['.windsurf/skills'] : []),
        ...(enabled.has('gemini') ? ['.gemini/skills'] : []),
        ...(enabled.has('junie') ? ['.junie/mcp/mcp.json'] : []),
        // Bridges this CLI adds to .gitignore, taken from the same table the sync uses
        // so the two lists cannot drift apart.
        ...SKILL_BRIDGES.filter((bridge) => bridge.gitignoreEntry && enabled.has(bridge.integration)).map(
          (bridge) => bridge.gitignoreEntry as string,
        ),
        ...(enabled.has('antigravity') ? ['.agents/mcp_config.json'] : []),
        ...(enabled.has('opencode') && !path.relative(options.projectRoot, paths.opencodeConfig).startsWith('..') && !path.isAbsolute(path.relative(options.projectRoot, paths.opencodeConfig))
          ? [path.relative(options.projectRoot, paths.opencodeConfig)]
          : [])
      ]
    : []
  trackedChecks.push('.agents/generated', '.agents/local.json')
  const trackedByGit: string[] = []
  for (const candidate of [...new Set(trackedChecks)]) {
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
    if (grokTrustNeedsFix) {
      actions.push('Would set Grok folder trust for this repo.')
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
    if (grokTrustNeedsFix) {
      try {
        await ensureGrokProjectTrusted(options.projectRoot)
        actions.push('Set Grok folder trust.')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push({ level: 'warning', message: `Failed to set Grok trust automatically: ${message}` })
      }
    }
    try {
      const syncResult = await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
      actions.push('Ran agents sync.')
      // The sync knows things doctor does not check for itself, such as a config it had
      // to skip. Dropping its warnings here is how a broken integration stayed invisible.
      for (const warning of syncResult.warnings) {
        issues.push({ level: 'warning', message: warning })
      }
      fixSpin.stop('Fixes applied')
    } catch (error) {
      fixSpin.stop('Fixes failed')
      throw error
    }
  }

  if (config.integrations.enabled.includes('antigravity')) {
    const antigravitySkills = await inspectAntigravitySkillsBridge(paths.agentsSkillsDir, paths.geminiSkillsBridge)
    if (antigravitySkills.expectedSkillNames.length > 0 && antigravitySkills.duplicateNames.length === 0) {
      if (!antigravitySkills.exists) {
        issues.push({
          level: 'warning',
          message: 'Antigravity skills bridge missing: .gemini/skills (run agents sync).'
        })
      } else if (!antigravitySkills.physicalDirectory) {
        issues.push({
          level: 'warning',
          message: 'Antigravity skills bridge must be a physical flat directory, not a symlink (run agents sync).'
        })
      } else if (!antigravitySkills.managed) {
        issues.push({
          level: 'warning',
          message: 'Existing .gemini/skills is not managed by agents; Antigravity nested skills were not synchronized.'
        })
      } else if (!antigravitySkills.inSync) {
        issues.push({
          level: 'warning',
          message: 'Antigravity skills bridge is out of sync with .agents/skills (run agents sync).'
        })
      }
    }
  }

  if (enabled.has('antigravity') && antigravityMcpSyncEnabled && !(await pathExists(paths.antigravityWorkspaceMcp)) && !applyFixes) {
    issues.push({
      level: 'warning',
      message: 'Antigravity workspace MCP file missing: .agents/mcp_config.json (run agents sync).'
    })
  }

  if (enabled.has('claude_desktop') && claudeDesktopConfigPath && !(await pathExists(claudeDesktopConfigPath)) && !applyFixes) {
    issues.push({
      level: 'warning',
      message: `Claude Desktop config missing: ${claudeDesktopConfigPath} (run agents sync).`
    })
  }

  if (enabled.has('windsurf') && !(await pathExists(windsurfGlobalMcpPath)) && !applyFixes) {
    issues.push({
      level: 'warning',
      message: `Windsurf global MCP file missing: ${windsurfGlobalMcpPath} (run agents sync).`
    })
  }

  if (enabled.has('opencode') && !(await pathExists(paths.opencodeConfig)) && !applyFixes) {
    const opencodeLabel = paths.isHome ? toHomeRelativePath(paths.opencodeConfig) : 'opencode.json'
    issues.push({
      level: 'warning',
      message: `OpenCode config missing: ${opencodeLabel} (run agents sync).`
    })
  }

  if (paths.isHome && (await pathExists(path.join(paths.root, 'opencode.json')))) {
    issues.push({
      level: 'warning',
      message: 'Found opencode.json in home directory (~/opencode.json). In global mode, OpenCode uses ~/.config/opencode/opencode.json.'
    })
  }

  if (enabled.has('antigravity') && (await pathExists(paths.antigravityProjectMcp))) {
    issues.push({
      level: 'warning',
      message: 'Legacy Antigravity project MCP file found at .antigravity/mcp.json. It is ignored; Antigravity now uses .agents/mcp_config.json.'
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

/**
 * Validate the existence and syntax of managed/generated integration configuration files and append any parse errors to `issues`.
 *
 * Validates a fixed set of generated TOML/JSON files and additional integration-specific config files when their integration names appear in `enabledIntegrations`. When a file exists but fails to parse, an error is pushed into the supplied `issues` array.
 *
 * @param paths - Project paths used to locate generated and workspace config files
 * @param enabledIntegrations - Integration names that enable validation of their non-generated config locations
 * @param claudeDesktopConfigPath - Optional path to Claude Desktop config; validated only if provided and the integration is enabled
 * @param windsurfGlobalMcpPath - Path to Windsurf global MCP config to validate when the integration is enabled
 * @param issues - Mutable list to which validation errors are appended
 */
async function validateManagedConfigSyntax(
  paths: ProjectPaths,
  enabledIntegrations: IntegrationName[],
  claudeDesktopConfigPath: string | undefined,
  windsurfGlobalMcpPath: string,
  issues: Issue[],
  options: { copilotCliPath: CopilotCliPath },
): Promise<void> {
  await validateTomlIfExists(paths.generatedCodex, '.agents/generated/codex.config.toml', issues)
  await validateJsonIfExists(paths.generatedGemini, '.agents/generated/gemini.settings.json', issues)
  await validateJsonIfExists(paths.generatedCopilot, '.agents/generated/copilot.vscode.mcp.json', issues)
  await validateJsonIfExists(paths.generatedCopilotCli, '.agents/generated/copilot.cli.mcp.json', issues)
  await validateJsonIfExists(paths.generatedCursor, '.agents/generated/cursor.mcp.json', issues)
  await validateJsonIfExists(paths.generatedAntigravity, '.agents/generated/antigravity.mcp_config.json', issues)
  await validateJsonIfExists(paths.generatedWindsurf, '.agents/generated/windsurf.mcp.json', issues)
  await validateJsonIfExists(paths.generatedOpencode, '.agents/generated/opencode.json', issues)
  await validateJsonIfExists(paths.generatedClaude, '.agents/generated/claude.mcp.json', issues)
  await validateJsonIfExists(paths.generatedClaudeDesktop, '.agents/generated/claude-desktop.mcp.json', issues)
  await validateJsonIfExists(paths.generatedJunie, '.agents/generated/junie.mcp.json', issues)
  await validateTomlIfExists(paths.generatedGrok, '.agents/generated/grok.config.toml', issues)
  await validateJsonIfExists(paths.generatedAmp, '.agents/generated/amp.settings.json', issues)
  await validateJsonIfExists(paths.generatedDroid, '.agents/generated/droid.mcp.json', issues)
  await validateJsoncIfExists(paths.generatedKilo, '.agents/generated/kilo.jsonc', issues)
  await validateJsonIfExists(paths.generatedDevin, '.agents/generated/devin.mcp_config.json', issues)
  await validateJsonIfExists(paths.generatedZed, '.agents/generated/zed.settings.json', issues)
  await validateJsonIfExists(paths.generatedGoose, '.agents/generated/goose.extensions.json', issues)

  if (enabledIntegrations.includes('codex')) {
    await validateTomlIfExists(paths.codexConfig, '.codex/config.toml', issues)
  }
  if (enabledIntegrations.includes('gemini')) {
    await validateJsonIfExists(paths.geminiSettings, '.gemini/settings.json', issues)
  }
  if (enabledIntegrations.includes('copilot_vscode')) {
    await validateJsonIfExists(paths.vscodeMcp, '.vscode/mcp.json', issues)
  }
  if (enabledIntegrations.includes('copilot_cli')) {
    const copilotCliMcpPath = options.copilotCliPath === '.github/mcp.json'
      ? paths.copilotCliGithubMcp
      : paths.copilotCliMcp
    await validateJsonIfExists(copilotCliMcpPath, options.copilotCliPath, issues)
  }
  if (enabledIntegrations.includes('cursor')) {
    await validateJsonIfExists(paths.cursorMcp, '.cursor/mcp.json', issues)
  }
  if (enabledIntegrations.includes('antigravity')) {
    await validateJsonIfExists(
      paths.antigravityWorkspaceMcp,
      '.agents/mcp_config.json',
      issues,
    )
  }
  if (enabledIntegrations.includes('claude_desktop') && claudeDesktopConfigPath) {
    await validateJsonIfExists(
      claudeDesktopConfigPath,
      `Claude Desktop config (${claudeDesktopConfigPath})`,
      issues,
    )
  }
  if (enabledIntegrations.includes('windsurf')) {
    await validateJsonIfExists(
      windsurfGlobalMcpPath,
      `Windsurf global MCP (${windsurfGlobalMcpPath})`,
      issues,
    )
  }
  if (enabledIntegrations.includes('opencode')) {
    const opencodeLabel = paths.isHome ? toHomeRelativePath(paths.opencodeConfig) : 'opencode.json'
    await validateJsonIfExists(paths.opencodeConfig, opencodeLabel, issues)
  }
  if (enabledIntegrations.includes('junie')) {
    await validateJsonIfExists(paths.junieMcp, '.junie/mcp/mcp.json', issues)
  }
  // Claude Code on project scope writes .mcp.json too, so the file has to be checked
  // even in a project that does not use Copilot CLI.
  if (enabledIntegrations.includes('claude') && !enabledIntegrations.includes('copilot_cli')) {
    await validateJsonIfExists(paths.copilotCliMcp, '.mcp.json', issues)
  }
  if (enabledIntegrations.includes('grok')) {
    await validateTomlIfExists(paths.grokConfig, toHomeRelativePath(paths.grokConfig), issues)
  }
  if (enabledIntegrations.includes('amp')) {
    await validateJsonIfExists(paths.ampSettings, toHomeRelativePath(paths.ampSettings), issues)
  }
  if (enabledIntegrations.includes('droid')) {
    await validateJsonIfExists(paths.droidMcp, toHomeRelativePath(paths.droidMcp), issues)
  }
  if (enabledIntegrations.includes('kilo')) {
    await validateJsoncIfExists(paths.kiloConfig, toHomeRelativePath(paths.kiloConfig), issues)
  }
  if (enabledIntegrations.includes('devin')) {
    await validateJsonIfExists(paths.devinMcp, toHomeRelativePath(paths.devinMcp), issues)
  }
  if (enabledIntegrations.includes('zed')) {
    await validateJsoncIfExists(paths.zedSettings, toHomeRelativePath(paths.zedSettings), issues)
  }
  if (enabledIntegrations.includes('goose')) {
    await validateYamlIfExists(paths.gooseConfig, toHomeRelativePath(paths.gooseConfig), issues)
  }
}


/** Zed and Kilo keep their settings as JSONC, so comments are not a syntax error. */
async function validateJsoncIfExists(filePath: string, label: string, issues: Issue[]): Promise<void> {
  if (!(await pathExists(filePath))) return
  const raw = await readTextOrEmpty(filePath)
  if (raw.trim().length === 0) return
  const errors: ParseError[] = []
  parseJsonc(raw, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    const first = errors[0]
    issues.push({
      level: 'error',
      message: `Invalid JSONC in ${label}: ${printParseErrorCode(first?.error ?? 0)} at offset ${String(first?.offset ?? 0)}`
    })
  }
}

/** Goose keeps its configuration as YAML. */
async function validateYamlIfExists(filePath: string, label: string, issues: Issue[]): Promise<void> {
  if (!(await pathExists(filePath))) return
  const raw = await readTextOrEmpty(filePath)
  if (raw.trim().length === 0) return
  const doc = YAML.parseDocument(raw)
  if (doc.errors.length > 0) {
    issues.push({
      level: 'error',
      message: `Invalid YAML in ${label}: ${doc.errors[0]?.message ?? 'parse error'}`
    })
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
