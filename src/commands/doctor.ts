import path from 'node:path'
import { lstat, readlink } from 'node:fs/promises'
import { loadProjectConfig } from '../core/config.js'
import { pathExists } from '../core/fs.js'
import { ensureRootAgentsLink } from '../core/linking.js'
import { loadResolvedRegistry } from '../core/mcp.js'
import { getProjectPaths } from '../core/paths.js'
import { commandExists, runCommand } from '../core/shell.js'
import { performSync } from '../core/sync.js'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../core/trust.js'
import { validateSkillsDirectory } from '../core/skillsValidation.js'
import { INTEGRATIONS } from '../integrations/registry.js'

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

  if (!(await pathExists(paths.agentsProject))) {
    issues.push({ level: 'error', message: 'Missing .agents/project.json (run agents start)' })
    report(issues)
    process.exitCode = 1
    return
  }

  if (!(await pathExists(paths.mcpSelection))) {
    issues.push({ level: 'error', message: 'Missing .agents/mcp/selection.json (run agents start)' })
  }

  let config
  try {
    config = await loadProjectConfig(options.projectRoot)
  } catch (error) {
    issues.push({ level: 'error', message: error instanceof Error ? error.message : String(error) })
    report(issues)
    process.exitCode = 1
    return
  }

  if (!(await pathExists(paths.agentsMd))) {
    issues.push({ level: 'error', message: 'Missing .agents/AGENTS.md' })
  }

  if (!(await pathExists(paths.rootAgentsMd))) {
    issues.push({ level: 'warning', message: 'Missing root AGENTS.md link/copy' })
  } else {
    const info = await lstat(paths.rootAgentsMd)
    if (info.isSymbolicLink()) {
      const target = await readlink(paths.rootAgentsMd)
      const resolved = path.resolve(options.projectRoot, target)
      if (resolved !== paths.agentsMd) {
        issues.push({ level: 'warning', message: 'Root AGENTS.md points to unexpected target' })
      }
    }
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

  const skillWarnings = await validateSkillsDirectory(paths.agentsSkillsDir)
  for (const warning of skillWarnings) {
    issues.push({ level: 'warning', message: warning })
  }

  for (const integration of INTEGRATIONS) {
    if (!config.enabledIntegrations.includes(integration.id)) continue
    if (!integration.requiredBinary) continue
    if (!commandExists(integration.requiredBinary)) {
      issues.push({
        level: 'warning',
        message: `${integration.label} binary "${integration.requiredBinary}" not found in PATH`
      })
    }
  }

  const codexEnabled = config.enabledIntegrations.includes('codex')
  if (codexEnabled) {
    const codexTrust = await getCodexTrustState(options.projectRoot)
    if (codexTrust !== 'trusted') {
      if (!options.fix) {
        issues.push({
          level: 'warning',
          message: 'Codex project trust is not set; project .codex/config.toml may be ignored.'
        })
      }
    }
  }

  const trackedChecks = config.syncMode === 'source-only'
    ? ['.codex/config.toml', '.gemini/settings.json', '.vscode/mcp.json', '.claude/skills']
    : []
  trackedChecks.push('.agents/generated', '.agents/mcp/local.json')
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
    if (await pathExists(paths.agentsMd)) {
      const linkResult = await ensureRootAgentsLink(options.projectRoot, { forceReplace: true })
      if (linkResult.warning) {
        issues.push({ level: 'warning', message: linkResult.warning })
      }
    }
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
