import { describe, expect, it } from 'vitest'
import { parseShellWords } from '../src/core/shellWords.js'

describe('parseShellWords', () => {
  it('parses unquoted args', () => {
    expect(parseShellWords('npx -y @upstash/context7-mcp')).toEqual(['npx', '-y', '@upstash/context7-mcp'])
  })

  it('parses quoted args and escaped whitespace', () => {
    expect(parseShellWords('node "my script.js" --name "Jane Doe" path\\ with\\ spaces')).toEqual([
      'node',
      'my script.js',
      '--name',
      'Jane Doe',
      'path with spaces'
    ])
  })

  it('supports empty quoted values', () => {
    expect(parseShellWords('--token "" --label \'\'')).toEqual(['--token', '', '--label', ''])
  })

  it('throws for unclosed quotes', () => {
    expect(() => parseShellWords('node "broken')).toThrow(/unclosed quote/i)
  })

  it('throws for dangling escape', () => {
    expect(() => parseShellWords('node path\\')).toThrow(/trailing escape/i)
  })
})
