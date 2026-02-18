import { describe, expect, it } from 'vitest'
import { parseTargetOptions, validateEnvKey, validateEnvValueForShell, validateHeaderKey } from '../src/core/mcpValidation.js'

describe('mcp validation', () => {
  it('validates environment variable keys', () => {
    expect(() => validateEnvKey('VALID_ENV_KEY')).not.toThrow()
    expect(() => validateEnvKey('_VALID2')).not.toThrow()
    expect(() => validateEnvKey('2INVALID')).toThrow(/Invalid/)
    expect(() => validateEnvKey('BAD KEY')).toThrow(/Invalid/)
    expect(() => validateEnvKey('BAD-KEY')).toThrow(/Invalid/)
  })

  it('validates header keys', () => {
    expect(() => validateHeaderKey('Authorization')).not.toThrow()
    expect(() => validateHeaderKey('X-Api-Key')).not.toThrow()
    expect(() => validateHeaderKey('x_custom.token')).not.toThrow()
    expect(() => validateHeaderKey('Bad Header')).toThrow(/Invalid/)
    expect(() => validateHeaderKey('Bad=Header')).toThrow(/Invalid/)
  })

  it('allows placeholder and token-like secret values', () => {
    expect(() => validateEnvValueForShell('GITHUB_TOKEN', '${GITHUB_TOKEN}', 'environment variable')).not.toThrow()
    expect(() => validateEnvValueForShell('ATLA_API_KEY', 'sk_live$AbC/123+=', 'environment variable')).not.toThrow()
    expect(() => validateEnvValueForShell('Authorization', 'Bearer abc.def-ghi_jkl', 'header')).not.toThrow()
  })

  it('rejects control characters', () => {
    expect(() => validateEnvValueForShell('GITHUB_TOKEN', 'abc\n123', 'environment variable')).toThrow(
      /contains control characters/,
    )
    expect(() => validateEnvValueForShell('Authorization', 'Bearer \u0000abc', 'header')).toThrow(
      /contains control characters/,
    )
  })

  it('parses target options including windsurf and opencode', () => {
    const targets = parseTargetOptions(['windsurf,opencode'])
    expect(targets).toEqual(['windsurf', 'opencode'])
  })
})
