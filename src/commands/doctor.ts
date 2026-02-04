import path from 'node:path'
import { lstat, readlink } from 'node:fs/promises'
import { loadConfig } from '../core/config.js'
import { pathExists, readJson } from '../core/fs.js'
import { ensureRootAgentsLink } from '../core/linking.js'
import { getProjectPaths } from '../core/paths.js'
import { commandExists } from '../core/shell.js'
import { performSync } from '../core/sync.js'
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

  if (!(await pathExists(paths.agentsConfig))) {
    issues.push({ level: 'error', message: 'Missing .agents/config.json (run agents init)' })
    report(issues)
    process.exitCode = 1
    return
  }

  let config
  try {
    config = await loadConfig(options.projectRoot)
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
    issues.push({ level: 'warning', message: 'Missing root AGENTS.md (link to .agents/AGENTS.md)' })
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
    const registry = await readJson<{ mcpServers?: Record<string, { requiredEnv?: string[] }> }>(
      paths.mcpRegistry,
    )
    for (const [name, server] of Object.entries(registry.mcpServers ?? {})) {
      for (const envName of server.requiredEnv ?? []) {
        if (!process.env[envName]) {
          issues.push({
            level: 'warning',
            message: `Required env var ${envName} is missing for server ${name}`
          })
        }
      }
    }
  } catch {
    issues.push({ level: 'error', message: 'Invalid .agents/mcp/registry.json' })
  }

  if (config.enabledIntegrations.includes('gemini')) {
    if (!(await pathExists(paths.geminiSettings))) {
      issues.push({ level: 'warning', message: 'Gemini enabled but .gemini/settings.json is missing' })
    }
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

  if (options.fix) {
    if (await pathExists(paths.agentsMd)) {
      const linkResult = await ensureRootAgentsLink(options.projectRoot, { forceReplace: true })
      if (linkResult.warning) {
        issues.push({ level: 'warning', message: linkResult.warning })
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
