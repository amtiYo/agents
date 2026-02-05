import { spawnSync } from 'node:child_process'

export interface ShellResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export function runCommand(cmd: string, args: string[], cwd: string, timeoutMs?: number): ShellResult {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {})
  })

  const stderr = result.stderr ?? (result.error ? String(result.error.message ?? result.error) : '')

  return {
    ok: (result.status ?? 1) === 0,
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr
  }
}

export function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [command], { stdio: 'ignore' })
  return (result.status ?? 1) === 0
}
