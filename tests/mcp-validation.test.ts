import { describe, expect, it } from 'vitest'
import { validateEnvValueForShell } from '../src/core/mcpValidation.js'

describe('mcp validation', () => {
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
})

