import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { runCommand, runCommandAsync } from '../src/core/shell.js'

const node = process.execPath

describe('runCommandAsync', () => {
  it('returns output and exit status like runCommand', async () => {
    const args = ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)']
    const asyncResult = await runCommandAsync(node, args, os.tmpdir())
    expect(asyncResult).toEqual({ ok: false, code: 3, stdout: 'out', stderr: 'err', timedOut: false })
    expect(runCommand(node, args, os.tmpdir())).toEqual(asyncResult)
  })

  it('reports a missing command without throwing', async () => {
    const result = await runCommandAsync('agents-test-missing-command', [], os.tmpdir())
    expect(result.ok).toBe(false)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('ENOENT')
  })

  it('stops a command at the timeout', async () => {
    const result = await runCommandAsync(node, ['-e', 'setTimeout(() => {}, 10_000)'], os.tmpdir(), 200)
    expect(result).toMatchObject({ ok: false, timedOut: true, stderr: 'command timed out' })
  })
})
