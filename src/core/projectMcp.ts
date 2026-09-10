import path from 'node:path'
import { ensureDir, pathExists, readJson, removeIfExists, writeJsonAtomic } from './fs.js'
import { toChangedEntry, writeManagedFile } from './managedFiles.js'
import { renderProjectMcpJson } from './renderers.js'
import type { AgentsConfig, ResolvedMcpServer } from '../types.js'

/**
 * `.mcp.json` in the repository root is read by both Claude Code (project scope)
 * and Copilot CLI, and `.github/mcp.json` is Copilot CLI's second location.
 * Both are written here so the two integrations never overwrite each other.
 */
export interface ProjectMcpState {
  /** Server names agents wrote into the file, so they can be removed later. */
  managedNames: string[]
  /** File the state describes, so a path change cleans up the previous file. */
  targetPath?: string
}

export async function readProjectMcpState(statePath: string): Promise<ProjectMcpState> {
  if (!(await pathExists(statePath))) return { managedNames: [] }
  try {
    const parsed = await readJson<ProjectMcpState>(statePath)
    return {
      managedNames: Array.isArray(parsed.managedNames)
        ? parsed.managedNames.filter((name): name is string => typeof name === 'string')
        : [],
      targetPath: typeof parsed.targetPath === 'string' ? parsed.targetPath : undefined
    }
  } catch {
    return { managedNames: [] }
  }
}

async function writeProjectMcpState(statePath: string, state: ProjectMcpState): Promise<void> {
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    managedNames: [...new Set(state.managedNames)].sort((a, b) => a.localeCompare(b)),
    ...(state.targetPath ? { targetPath: state.targetPath } : {})
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ProjectMcpPlan {
  /** Absolute path of the file to write, or `null` when nothing writes it. */
  targetPath: string | null
  /** Servers to write, merged across the integrations that share the file. */
  servers: ResolvedMcpServer[]
  /** Emit Copilot CLI's `tools` allowlist. */
  withTools: boolean
  warnings: string[]
}

/**
 * Decide what goes into the shared project MCP file for the current config.
 *
 * Claude Code contributes when its scope is `project`; Copilot CLI contributes when
 * it is enabled. When both write the same server name, the definitions are compared
 * and a warning is raised if they differ.
 */
export function planProjectMcp(args: {
  config: AgentsConfig
  claudeEnabled: boolean
  copilotCliEnabled: boolean
  claudeServers: ResolvedMcpServer[]
  copilotServers: ResolvedMcpServer[]
  paths: { copilotCliMcp: string; copilotCliGithubMcp: string }
}): ProjectMcpPlan {
  const { config, claudeEnabled, copilotCliEnabled, claudeServers, copilotServers, paths } = args
  const warnings: string[] = []
  const claudeUsesProjectScope = claudeEnabled && config.integrations.options.claudeScope === 'project'
  const copilotPath = config.integrations.options.copilotCliPath === '.github/mcp.json'
    ? paths.copilotCliGithubMcp
    : paths.copilotCliMcp
  const copilotUsesRootFile = copilotPath === paths.copilotCliMcp

  if (!claudeUsesProjectScope && !copilotCliEnabled) {
    return { targetPath: null, servers: [], withTools: false, warnings }
  }

  // Both tools read the repository root file, so a Claude local scope plus Copilot CLI
  // means Claude sees each server twice: once from ~/.claude.json, once from .mcp.json.
  if (claudeEnabled && !claudeUsesProjectScope && copilotCliEnabled && copilotUsesRootFile) {
    warnings.push(
      'Claude Code is on local scope while Copilot CLI writes .mcp.json, which Claude Code also reads. '
      + 'Servers will appear twice in Claude Code. Set integrations.options.claudeScope to "project", '
      + 'or point Copilot CLI at .github/mcp.json.',
    )
  }

  if (!claudeUsesProjectScope) {
    return { targetPath: copilotPath, servers: copilotServers, withTools: true, warnings }
  }

  if (!copilotCliEnabled) {
    return { targetPath: paths.copilotCliMcp, servers: claudeServers, withTools: false, warnings }
  }

  if (!copilotUsesRootFile) {
    // Copilot CLI was pointed at .github/mcp.json, so the root file belongs to Claude alone.
    return { targetPath: paths.copilotCliMcp, servers: claudeServers, withTools: false, warnings }
  }

  const byName = new Map<string, ResolvedMcpServer>()
  for (const server of claudeServers) {
    byName.set(server.name, server)
  }
  for (const server of copilotServers) {
    const existing = byName.get(server.name)
    if (existing && JSON.stringify(existing) !== JSON.stringify(server)) {
      warnings.push(
        `MCP server "${server.name}" resolves differently for Claude Code and Copilot CLI, but both read .mcp.json. `
        + 'Using the Claude Code definition.',
      )
      continue
    }
    byName.set(server.name, server)
  }

  const merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (claudeServers.length > 0 && copilotServers.length > 0) {
    const claudeOnly = claudeServers.filter((server) => !copilotServers.some((item) => item.name === server.name))
    const copilotOnly = copilotServers.filter((server) => !claudeServers.some((item) => item.name === server.name))
    if (claudeOnly.length > 0 || copilotOnly.length > 0) {
      warnings.push(
        'Claude Code and Copilot CLI both read .mcp.json, so per-tool targets cannot isolate servers in it: '
        + `${[...claudeOnly, ...copilotOnly].map((server) => server.name).join(', ')} will be visible to both.`,
      )
    }
  }

  return { targetPath: paths.copilotCliMcp, servers: merged, withTools: true, warnings }
}

/**
 * Write (or clean up) the shared project MCP file, preserving servers that were
 * added to it by hand and removing only the entries agents previously wrote.
 */
export async function syncProjectMcpFile(args: {
  plan: ProjectMcpPlan
  statePath: string
  generatedPath: string
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { plan, statePath, generatedPath, projectRoot, check, changed, warnings } = args
  const state = await readProjectMcpState(statePath)

  const rendered = renderProjectMcpJson(plan.servers, {
    tools: plan.withTools,
    label: plan.targetPath ? path.relative(projectRoot, plan.targetPath) || plan.targetPath : '.mcp.json'
  })
  warnings.push(...rendered.warnings, ...plan.warnings)

  await writeManagedFile({
    absolutePath: generatedPath,
    content: `${JSON.stringify({ mcpServers: rendered.mcpServers }, null, 2)}\n`,
    projectRoot,
    check,
    changed
  })

  const previousPath = state.targetPath
  if (previousPath && previousPath !== plan.targetPath) {
    await cleanupProjectMcpFile({
      targetPath: previousPath,
      managedNames: state.managedNames,
      projectRoot,
      check,
      changed,
      warnings
    })
  }

  if (!plan.targetPath) {
    if (previousPath === undefined && state.managedNames.length === 0) return
    if (previousPath && previousPath === plan.targetPath) return
    if (!previousPath) return
    if (!check) await writeProjectMcpState(statePath, { managedNames: [] })
    return
  }

  let existingServers: Record<string, unknown> = {}
  if (await pathExists(plan.targetPath)) {
    try {
      const parsed = await readJson<unknown>(plan.targetPath)
      if (!isRecord(parsed)) {
        warnings.push(`Existing ${plan.targetPath} is not a JSON object; skipped project MCP sync.`)
        return
      }
      existingServers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Failed to read ${plan.targetPath}; skipped project MCP sync. ${message}`)
      return
    }
  }

  const next: Record<string, unknown> = { ...existingServers }
  for (const name of state.managedNames) {
    delete next[name]
  }
  for (const [name, server] of Object.entries(rendered.mcpServers)) {
    next[name] = server
  }

  const unmanaged = Object.keys(next).filter((name) => !(name in rendered.mcpServers))
  if (Object.keys(next).length === 0 && unmanaged.length === 0) {
    if (await pathExists(plan.targetPath)) {
      changed.push(toChangedEntry(projectRoot, plan.targetPath))
      if (!check) await removeIfExists(plan.targetPath)
    }
    if (!check) {
      await writeProjectMcpState(statePath, { managedNames: [], targetPath: plan.targetPath })
    }
    return
  }

  await writeManagedFile({
    absolutePath: plan.targetPath,
    content: `${JSON.stringify({ mcpServers: next }, null, 2)}\n`,
    projectRoot,
    check,
    changed
  })

  if (!check) {
    await writeProjectMcpState(statePath, {
      managedNames: Object.keys(rendered.mcpServers),
      targetPath: plan.targetPath
    })
  }
}

async function cleanupProjectMcpFile(args: {
  targetPath: string
  managedNames: string[]
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<void> {
  const { targetPath, managedNames, projectRoot, check, changed, warnings } = args
  if (managedNames.length === 0 || !(await pathExists(targetPath))) return

  let parsed: unknown
  try {
    parsed = await readJson<unknown>(targetPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`Failed to read ${targetPath} while cleaning up managed MCP servers. ${message}`)
    return
  }

  if (!isRecord(parsed)) return
  const servers = isRecord(parsed.mcpServers) ? { ...parsed.mcpServers } : {}
  for (const name of managedNames) {
    delete servers[name]
  }

  const otherKeys = Object.keys(parsed).filter((key) => key !== 'mcpServers')
  if (Object.keys(servers).length === 0 && otherKeys.length === 0) {
    changed.push(toChangedEntry(projectRoot, targetPath))
    if (!check) await removeIfExists(targetPath)
    return
  }

  await writeManagedFile({
    absolutePath: targetPath,
    content: `${JSON.stringify({ ...parsed, mcpServers: servers }, null, 2)}\n`,
    projectRoot,
    check,
    changed
  })
}
