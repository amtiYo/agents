import { execFile, spawnSync } from 'node:child_process'

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

/** Like `runCommand`, without blocking, so independent CLI probes can run side by side. */
export function runCommandAsync(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_RUN_COMMAND_TIMEOUT_MS,
): Promise<ShellResult> {
  const effectiveTimeout = timeoutMs > 0 ? timeoutMs : undefined
  return new Promise((resolve) => {
    execFile(cmd, args, {
      cwd,
      encoding: 'utf8',
      ...(effectiveTimeout !== undefined ? { timeout: effectiveTimeout } : {})
    }, (error, stdout, stderr) => {
      const timedOut = Boolean(error?.killed) && effectiveTimeout !== undefined
      // A numeric code is the exit status; a string code such as ENOENT means it never ran.
      const exitCode = typeof error?.code === 'number' ? error.code : null
      let fallback = ''
      if (timedOut) fallback = 'command timed out'
      else if (error && exitCode === null) fallback = error.message
      resolve({
        ok: !error,
        code: error ? (exitCode ?? 1) : 0,
        stdout: stdout ?? '',
        stderr: stderr || fallback,
        timedOut
      })
    })
  })
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
