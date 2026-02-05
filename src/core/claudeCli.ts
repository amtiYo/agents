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

export function listClaudeManagedServerNames(projectRoot: string, prefix = 'agents__'): ClaudeMcpListResult {
  const result = runCommand('claude', ['mcp', 'list'], projectRoot)
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

