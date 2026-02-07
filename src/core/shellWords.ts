export function parseShellWords(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let inSingle = false
  let inDouble = false
  let escaping = false

  const flush = (): void => {
    if (!hasToken) return
    tokens.push(current)
    current = ''
    hasToken = false
  }

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] as string

    if (escaping) {
      current += char
      hasToken = true
      escaping = false
      continue
    }

    if (inSingle) {
      if (char === '\'') {
        inSingle = false
      } else {
        current += char
      }
      hasToken = true
      continue
    }

    if (inDouble) {
      if (char === '"') {
        inDouble = false
      } else if (char === '\\') {
        const next = input[i + 1]
        if (next && ['\\', '"', '$', '`'].includes(next)) {
          current += next
          i += 1
        } else {
          current += char
        }
      } else {
        current += char
      }
      hasToken = true
      continue
    }

    if (/\s/.test(char)) {
      flush()
      continue
    }

    if (char === '\'') {
      inSingle = true
      hasToken = true
      continue
    }

    if (char === '"') {
      inDouble = true
      hasToken = true
      continue
    }

    if (char === '\\') {
      escaping = true
      hasToken = true
      continue
    }

    current += char
    hasToken = true
  }

  if (escaping) {
    throw new Error('Invalid args: trailing escape character.')
  }
  if (inSingle || inDouble) {
    throw new Error('Invalid args: unclosed quote.')
  }

  flush()
  return tokens
}
