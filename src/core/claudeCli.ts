import os from 'node:os'
import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { runCommand } from './shell.js'
import { sanitizeTerminalOutput } from './cursorCli.js'

export interface ClaudeMcpListResult {
  ok: boolean
  names: string[]
  stderr: string
}

export function parseClaudeManagedServerNames(output: string, prefix = 'agents__'): string[] {
  const names = new Set<string>()
  const lines = sanitizeTerminalOutput(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9._:-]+):/)
    if (!match?.[1]) continue
    const name = match[1]
    if (!name.startsWith(prefix)) continue
    names.add(name)
  }

  return [...names].sort((a, b) => a.localeCompare(b))
}

export function listClaudeManagedServerNames(
  projectRoot: string,
  prefix = 'agents__',
  timeoutMs?: number,
): ClaudeMcpListResult {
  const result = runCommand('claude', ['mcp', 'list'], projectRoot, timeoutMs)
  if (!result.ok) {
    return {
      ok: false,
      names: [],
      stderr: result.stderr
    }
  }

  return {
    ok: true,
    names: parseClaudeManagedServerNames(`${result.stdout}\n${result.stderr}`, prefix),
    stderr: result.stderr
  }
}

/** File where Claude Code keeps user-scope and local-scope MCP registrations. */
export function getClaudeUserConfigPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  return path.join(configDir ? path.resolve(configDir) : os.homedir(), '.claude.json')
}

/**
 * Read the names registered in one Claude scope straight from Claude's config file.
 *
 * `claude mcp list` health-checks every configured server, which takes seconds with a
 * dozen servers and can run past the sync timeout. Only reads come from the file;
 * registrations are still written through the CLI. Returns null when the file is
 * missing, unreadable or shaped differently, so the caller falls back to the CLI.
 */
export async function readClaudeScopeServerNames(
  projectRoot: string,
  scope: 'local' | 'user',
  prefix: string,
): Promise<string[] | null> {
  // Claude's project keys on Windows are not verified; the CLI stays the source there.
  if (process.platform === 'win32') return null

  let config: unknown
  try {
    config = JSON.parse(await readFile(getClaudeUserConfigPath(), 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(config)) return null

  let servers: unknown = config.mcpServers ?? {}
  if (scope === 'local') {
    const projects = config.projects ?? {}
    if (!isRecord(projects)) return null
    let projectKey: string
    try {
      // Claude records a project under its resolved path, as `process.cwd()` reports it.
      projectKey = await realpath(projectRoot)
    } catch {
      return null
    }
    const project = projects[projectKey] ?? {}
    if (!isRecord(project)) return null
    servers = project.mcpServers ?? {}
  }
  if (!isRecord(servers)) return null

  return Object.keys(servers)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
