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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface ProjectMcpTarget {
  /** Absolute path of the file to write. */
  targetPath: string
  /** Servers to write into it. */
  servers: ResolvedMcpServer[]
  /** Emit Copilot CLI's `tools` allowlist. */
  withTools: boolean
}

export interface ProjectMcpPlan {
  /** Files this run should own; empty when no integration writes a project MCP file. */
  targets: ProjectMcpTarget[]
  warnings: string[]
}

/**
 * Decide what goes into the project MCP files for the current config.
 *
 * Claude Code contributes when its scope is `project`; Copilot CLI contributes when
 * it is enabled. They share the repository-root `.mcp.json` unless Copilot CLI is
 * pointed at `.github/mcp.json`, in which case each tool gets its own file.
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
    return { targets: [], warnings }
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

  const targets: ProjectMcpTarget[] = []

  if (copilotCliEnabled && !copilotUsesRootFile) {
    // Separate files: Copilot CLI reads .github/mcp.json, Claude Code the root file.
    targets.push({ targetPath: copilotPath, servers: copilotServers, withTools: true })
    if (claudeUsesProjectScope) {
      targets.push({ targetPath: paths.copilotCliMcp, servers: claudeServers, withTools: false })
    }
    return { targets, warnings }
  }

  if (!claudeUsesProjectScope) {
    return { targets: [{ targetPath: copilotPath, servers: copilotServers, withTools: true }], warnings }
  }

  if (!copilotCliEnabled) {
    return { targets: [{ targetPath: paths.copilotCliMcp, servers: claudeServers, withTools: false }], warnings }
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

  const claudeOnly = claudeServers.filter((server) => !copilotServers.some((item) => item.name === server.name))
  const copilotOnly = copilotServers.filter((server) => !claudeServers.some((item) => item.name === server.name))
  if (claudeOnly.length > 0 || copilotOnly.length > 0) {
    warnings.push(
      'Claude Code and Copilot CLI both read .mcp.json, so per-tool targets cannot isolate servers in it: '
      + `${[...claudeOnly, ...copilotOnly].map((server) => server.name).join(', ')} will be visible to both.`,
    )
  }

  const merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { targets: [{ targetPath: paths.copilotCliMcp, servers: merged, withTools: true }], warnings }
}

/** State per file, so a plan with two files tracks each one separately. */
interface ProjectMcpStateFile {
  files: Record<string, string[]>
}

/**
 * Read which servers agents wrote into each project MCP file.
 *
 * @returns A map of absolute file path to the server names agents owns in it.
 */
export async function readProjectMcpManagedNames(statePath: string): Promise<Record<string, string[]>> {
  return readStateFiles(statePath)
}

async function readStateFiles(statePath: string): Promise<Record<string, string[]>> {
  if (!(await pathExists(statePath))) return {}
  try {
    const parsed = await readJson<ProjectMcpStateFile & ProjectMcpState>(statePath)
    if (parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
      return Object.fromEntries(
        Object.entries(parsed.files).map(([file, names]) => [
          file,
          Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []
        ]),
      )
    }
    // Older state files tracked a single path.
    if (typeof parsed.targetPath === 'string' && Array.isArray(parsed.managedNames)) {
      return { [parsed.targetPath]: parsed.managedNames.filter((name): name is string => typeof name === 'string') }
    }
    return {}
  } catch {
    return {}
  }
}

async function writeStateFiles(statePath: string, files: Record<string, string[]>): Promise<void> {
  await ensureDir(path.dirname(statePath))
  await writeJsonAtomic(statePath, {
    files: Object.fromEntries(
      Object.entries(files)
        .filter(([, names]) => names.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, names]) => [file, [...new Set(names)].sort((a, b) => a.localeCompare(b))]),
    )
  })
}

/**
 * Write the project MCP files for a plan, preserving servers and other top-level
 * keys that the file already had, and removing only the entries agents wrote before.
 */
export async function syncProjectMcpFile(args: {
  plan: ProjectMcpPlan
  statePath: string
  generatedPath: string
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
  /**
   * Every server name the config defines, including disabled ones. Used as the managed
   * set when no state file exists yet, which is the case for projects upgrading from
   * 0.8.x, where this file was rewritten wholesale.
   */
  knownServerNames?: string[]
}): Promise<void> {
  const { plan, statePath, generatedPath, projectRoot, check, changed, warnings, knownServerNames } = args
  const hasState = await pathExists(statePath)
  const previousFiles = await readStateFiles(statePath)
  warnings.push(...plan.warnings)

  const nextFiles: Record<string, string[]> = {}
  const generatedPreview: Record<string, Record<string, unknown>> = {}

  for (const target of plan.targets) {
    const rendered = renderProjectMcpJson(target.servers, {
      tools: target.withTools,
      label: path.relative(projectRoot, target.targetPath) || target.targetPath
    })
    warnings.push(...rendered.warnings)
    // Keyed per file: with two targets a merged preview would hide which server
    // belongs where, and identical names would shadow each other.
    generatedPreview[path.relative(projectRoot, target.targetPath) || target.targetPath] = rendered.mcpServers

    const written = await writeProjectMcpTarget({
      targetPath: target.targetPath,
      managedServers: rendered.mcpServers,
      previousManagedNames: previousFiles[target.targetPath] ?? (hasState ? [] : knownServerNames ?? []),
      adopting: !hasState && previousFiles[target.targetPath] === undefined,
      projectRoot,
      check,
      changed,
      warnings
    })
    nextFiles[target.targetPath] = written
  }

  await writeManagedFile({
    absolutePath: generatedPath,
    content: `${JSON.stringify({ files: generatedPreview }, null, 2)}\n`,
    projectRoot,
    check,
    changed
  })

  // Files this run no longer owns lose their managed entries.
  for (const [file, managedNames] of Object.entries(previousFiles)) {
    if (nextFiles[file] !== undefined) continue
    await cleanupProjectMcpFile({ targetPath: file, managedNames, projectRoot, check, changed, warnings })
  }

  if (!check) {
    await writeStateFiles(statePath, nextFiles)
  }
}

/**
 * Merge the managed servers into one file.
 *
 * @returns The server names now owned by agents in that file.
 */
async function writeProjectMcpTarget(args: {
  targetPath: string
  managedServers: Record<string, unknown>
  previousManagedNames: string[]
  /** True when the managed set came from the config because no state file existed. */
  adopting: boolean
  projectRoot: string
  check: boolean
  changed: string[]
  warnings: string[]
}): Promise<string[]> {
  const { targetPath, managedServers, previousManagedNames, adopting, projectRoot, check, changed, warnings } = args

  let existing: Record<string, unknown> = {}
  if (await pathExists(targetPath)) {
    try {
      const parsed = await readJson<unknown>(targetPath)
      if (!isRecord(parsed)) {
        warnings.push(`Existing ${targetPath} is not a JSON object; skipped project MCP sync.`)
        return previousManagedNames
      }
      existing = parsed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Failed to read ${targetPath}; skipped project MCP sync. ${message}`)
      return previousManagedNames
    }
  }

  const existingServers = isRecord(existing.mcpServers) ? existing.mcpServers : {}
  const nextServers: Record<string, unknown> = { ...existingServers }
  for (const name of previousManagedNames) {
    delete nextServers[name]
  }
  for (const [name, server] of Object.entries(managedServers)) {
    // Only when adopting a file this CLI has not written before: an entry already
    // there under the same name belongs to whoever wrote it by hand.
    if (adopting && name in existingServers && JSON.stringify(existingServers[name]) !== JSON.stringify(server)) {
      warnings.push(
        `${path.basename(targetPath)} already had a server named "${name}" with a different definition; it was replaced by the one from .agents/agents.json.`,
      )
    }
    nextServers[name] = server
  }

  const otherKeys = Object.keys(existing).filter((key) => key !== 'mcpServers')
  if (Object.keys(nextServers).length === 0 && otherKeys.length === 0) {
    if (await pathExists(targetPath)) {
      changed.push(toChangedEntry(projectRoot, targetPath))
      if (!check) await removeIfExists(targetPath)
    }
    return []
  }

  await writeManagedFile({
    absolutePath: targetPath,
    // Other top-level keys (Copilot CLI's `inputs`, for example) are kept.
    content: `${JSON.stringify({ ...existing, mcpServers: nextServers }, null, 2)}\n`,
    projectRoot,
    check,
    changed
  })

  return Object.keys(managedServers)
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
