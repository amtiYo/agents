import { spawnSync } from 'node:child_process'

export interface ShellResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

const DEFAULT_RUN_COMMAND_TIMEOUT_MS = 15_000

export function runCommand(cmd: string, args: string[], cwd: string, timeoutMs = DEFAULT_RUN_COMMAND_TIMEOUT_MS): ShellResult {
  const effectiveTimeout = timeoutMs > 0 ? timeoutMs : undefined
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    ...(effectiveTimeout !== undefined ? { timeout: effectiveTimeout } : {})
  })

  const timedOut = isTimeoutError(result.error)
  const fallbackError = result.error ? String(result.error.message ?? result.error) : ''
  const stderr = result.stderr ?? (timedOut ? 'command timed out' : fallbackError)

  return {
    ok: (result.status ?? 1) === 0,
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr,
    timedOut
  }
}

export function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [command], { stdio: 'ignore' })
  return (result.status ?? 1) === 0
}

function isTimeoutError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (!('code' in error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'ETIMEDOUT'
}
