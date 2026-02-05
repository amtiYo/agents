import { describe, expect, it } from 'vitest'
import { parseCursorMcpStatuses, sanitizeTerminalOutput } from '../src/core/cursorCli.js'

describe('cursorCli parser', () => {
  it('sanitizes cursor control sequences', () => {
    const raw = '\u001b[2K\u001b[GLoading MCPs…\n\u001b[2K\u001b[1A\u001b[2K\u001b[Gappsai: ready\n'
    const sanitized = sanitizeTerminalOutput(raw)
    expect(sanitized).toContain('Loading MCPs…')
    expect(sanitized).toContain('appsai: ready')
    expect(sanitized).not.toContain('\u001b[')
  })

  it('parses Cursor MCP statuses reliably', () => {
    const output = [
      '\u001b[2K\u001b[GLoading MCPs…',
      '\u001b[2K\u001b[1A\u001b[2K\u001b[Gappsai: ready',
      'context7: not loaded (needs approval)',
      'fetch: disabled',
      'filesystem: Error: Connection failed',
      'git: disconnected',
      'docs: something unexpected',
      'noise line'
    ].join('\n')

    const statuses = parseCursorMcpStatuses(output)
    expect(statuses.appsai).toBe('ready')
    expect(statuses.context7).toBe('needs-approval')
    expect(statuses.fetch).toBe('disabled')
    expect(statuses.filesystem).toBe('error')
    expect(statuses.git).toBe('error')
    expect(statuses.docs).toBe('unknown')
    expect(statuses.noise).toBeUndefined()
  })
})
