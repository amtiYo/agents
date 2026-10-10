import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../src/recall/redact.js'

describe('quoted recall secrets', () => {
  it.each([
    ['token', 'abcdef0123456789abcdef0123456789'],
    ['password', 'p@ssw0rd-12345678'],
    ['client_secret', 'spaces and "quotes" with \\slashes'],
    ['API_KEY', 'abc123'],
    ['pwd', 'a!b']
  ])('redacts quoted %s fields without breaking JSON', (key, secret) => {
    const result = redactSecrets(JSON.stringify({ [key]: secret, normal: 'searchable notes' }))
    expect(result.text).not.toContain(secret)
    expect(JSON.parse(result.text)).toEqual({ [key]: '[redacted]', normal: 'searchable notes' })
    expect(result.count).toBeGreaterThan(0)
  })

  it('handles single-quoted keys and values in transcript prose', () => {
    expect(redactSecrets("Saved {'password': 'some pa$$word!', 'note': 'keep me'}").text)
      .toBe("Saved {'password': '[redacted]', 'note': 'keep me'}")
  })

  it('preserves ordinary quoted values and existing assignment redaction', () => {
    expect(redactSecrets('{"monkey":"banana", "token_count":12}').text)
      .toBe('{"monkey":"banana", "token_count":12}')
    expect(redactSecrets('password=p@ssw0rd-12345678').text).toContain('[redacted]')
  })
})
