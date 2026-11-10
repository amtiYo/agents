import { describe, expect, it } from 'vitest'
import { resolveServer } from '../src/core/mcp.js'
import { listOpencodeServerNames, normalizeOpencodeConfig, OPENCODE_CONFIG_SCHEMA } from '../src/core/opencode.js'
import { buildOpencodePayload } from '../src/integrations/opencode.js'

describe('normalizeOpencodeConfig', () => {
  it('defaults $schema when missing so a from-scratch file matches OpenCode docs', () => {
    const result = normalizeOpencodeConfig({ mcp: {} })
    expect(result.$schema).toBe(OPENCODE_CONFIG_SCHEMA)
    expect(Object.keys(result)[0]).toBe('$schema')
    expect(result.mcp).toEqual({})
  })

  it('preserves an existing $schema and unmanaged fields', () => {
    const result = normalizeOpencodeConfig({
      theme: 'solarized',
      $schema: 'https://example.com/custom.json',
      mcp: { legacy: { type: 'remote' } }
    })
    expect(result.$schema).toBe('https://example.com/custom.json')
    expect(result.theme).toBe('solarized')
    expect(result.mcp).toEqual({ legacy: { type: 'remote' } })
  })
})

describe('buildOpencodePayload', () => {
  it('includes OpenCode $schema even with no servers', () => {
    expect(buildOpencodePayload([]).payload).toEqual({
      $schema: OPENCODE_CONFIG_SCHEMA,
      mcp: { servers: {} }
    })
  })
})

describe('opencode options in agents.json', () => {
  it('reaches the OpenCode preview through server resolution', () => {
    const server = resolveServer('browser', {
      transport: 'stdio',
      command: 'npx',
      opencode: { disabled: true, timeout: { startup: 3000 } }
    }, '/tmp', [])
    expect(buildOpencodePayload([server]).payload.mcp).toEqual({ servers: {
      browser: { type: 'local', command: ['npx'], disabled: true, timeout: { startup: 3000 } }
    } })
  })

  it.each([
    [{ timeout: { startup: 0 } }, /positive integer/],
    [{ timeout: { connect: 10 } }, /Unknown opencode.timeout field "connect"/],
    [{ protocol: 'v3' }, /must be one of/],
    [{ oauth: { client_id: 'x' } }, /can only be false/],
    [{ disabled: 'yes' }, /true or false/],
    [{ enabled: false }, /Unknown opencode option "enabled"/]
  ])('rejects %j', (opencode, message) => {
    expect(() => resolveServer('bad', { transport: 'stdio', command: 'x', opencode } as never, '/tmp', [])).toThrow(message)
  })
})

describe('listOpencodeServerNames', () => {
  it('lists servers from both shapes and skips V2 settings', () => {
    expect(listOpencodeServerNames({
      legacy: { type: 'local', command: ['a'] },
      timeout: { startup: 1 },
      servers: { modern: { type: 'remote', url: 'https://example.com' } }
    })).toEqual(['legacy', 'modern'])
  })

  it('treats a legacy server named "servers" as a server', () => {
    expect(listOpencodeServerNames({ servers: { type: 'local', command: ['a'] } })).toEqual(['servers'])
  })
})
