import { runCommand } from './shell.js'

export type CursorServerState = 'ready' | 'needs-approval' | 'disabled' | 'unknown'

export interface CursorMcpListResult {
  ok: boolean
  statuses: Record<string, CursorServerState>
  stderr: string
}

const ANSI_PATTERN = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g

export function sanitizeTerminalOutput(input: string): string {
  return input
    .replace(ANSI_PATTERN, '')
    .replace(/\r/g, '\n')
}

export function parseCursorMcpStatuses(output: string): Record<string, CursorServerState> {
  const statuses: Record<string, CursorServerState> = {}
  const lines = sanitizeTerminalOutput(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines) {
    const match = line.match(/^([a-zA-Z0-9._:-]+):\s*(.+)$/)
    if (!match) continue

    const name = match[1]
    const statusText = match[2].toLowerCase()
    if (!name) continue

    if (statusText.includes('ready')) {
      statuses[name] = 'ready'
      continue
    }
    if (statusText.includes('needs approval') || statusText.includes('not loaded')) {
      statuses[name] = 'needs-approval'
      continue
    }
    if (statusText.includes('disabled')) {
      statuses[name] = 'disabled'
      continue
    }

    statuses[name] = 'unknown'
  }

  return statuses
}

export function listCursorMcpStatuses(projectRoot: string): CursorMcpListResult {
  const result = runCommand('cursor-agent', ['mcp', 'list'], projectRoot)
  if (!result.ok) {
    return {
      ok: false,
      statuses: {},
      stderr: result.stderr
    }
  }

  return {
    ok: true,
    statuses: parseCursorMcpStatuses(`${result.stdout}\n${result.stderr}`),
    stderr: result.stderr
  }
}

