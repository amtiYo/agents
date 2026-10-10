import { describe, expect, it } from 'vitest'
import { normalizeOpencodeConfig, OPENCODE_CONFIG_SCHEMA } from '../src/core/opencode.js'
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
      mcp: {}
    })
  })
})
