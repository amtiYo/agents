export const REDACTED_PLACEHOLDER = '[redacted]'

export interface RedactResult {
  text: string
  count: number
}

const PEM_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/g
const PEM_OPEN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----(?:[ \t]*\r?\n[A-Za-z0-9+/=]{16,}[ \t]*)+/g
const AWS_ACCESS = /\bA(?:KIA|SIA)[0-9A-Z]{16}\b/g
const PROVIDER_TOKEN =
  /\b(gh[opsur]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]*[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{30,}|xox[bpcs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g
const CONN_URL = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^\s/@:]{0,128}):([^\s]+)@([^\s]+)/g
const BEARER = /\b(Bearer|Basic)(\s+)([A-Za-z0-9._~+/=-]{16,})/gi
// Quoted JSON/JSON-like fields can contain punctuation, spaces and escaped quotes.
const QUOTED_SECRET =
  /(['"])([\w.-]{0,80}?(?:api[_-]?key|secret|token|passwd|password|pwd|authorization|access[_-]?token|client[_-]?secret|_key))\1(\s*[:=]\s*)(['"])((?:\\[\s\S]|(?!\4)[^\\])*)\4/gi
const ASSIGNED_SECRET =
  /\b([\w.-]{0,80}?(?:api[_-]?key|secret|token|passwd|password|authorization|access[_-]?token|client[_-]?secret))\s*[:=]\s*(['"]?)([A-Za-z0-9/+=._-]{16,})\2/gi
const ENV_KEY = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_KEY)\s*[:=]\s*(['"]?)([A-Za-z0-9/+=._-]{16,})\2/g
const PASSWORD_ASSIGN = /\b([\w.-]{0,64}?(?:password|passwd|pwd))\s*=\s*(['"]?)([^\s'"&]{3,128})\2/gi

function apply(pattern: RegExp, text: string, replacement: string | ((...args: string[]) => string)): { text: string; count: number } {
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let count = 0
  const next = text.replace(re, (...args) => {
    count += 1
    return typeof replacement === 'string' ? replacement : replacement(...args)
  })
  return { text: next, count }
}

/**
 * Strip credentials from speech before it is written to the index.
 *
 * Surrounding prose stays searchable; only the secret value is replaced.
 */
export function redactSecrets(input: string): RedactResult {
  if (!input) return { text: input, count: 0 }

  let text = input
  let count = 0

  const steps: Array<() => void> = [
    () => {
      const result = apply(PEM_BLOCK, text, REDACTED_PLACEHOLDER)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(PEM_OPEN, text, REDACTED_PLACEHOLDER)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(AWS_ACCESS, text, REDACTED_PLACEHOLDER)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(QUOTED_SECRET, text, (_full, keyQuote, key, separator, valueQuote) =>
        `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${REDACTED_PLACEHOLDER}${valueQuote}`)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(ASSIGNED_SECRET, text, (_full, key, quote) => `${key}=${quote}${REDACTED_PLACEHOLDER}${quote}`)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(ENV_KEY, text, (_full, key, quote) => `${key}=${quote}${REDACTED_PLACEHOLDER}${quote}`)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(PASSWORD_ASSIGN, text, (_full, key, quote) => `${key}=${quote}${REDACTED_PLACEHOLDER}${quote}`)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(BEARER, text, (_full, scheme, space) => `${scheme}${space}${REDACTED_PLACEHOLDER}`)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(PROVIDER_TOKEN, text, REDACTED_PLACEHOLDER)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(JWT, text, REDACTED_PLACEHOLDER)
      text = result.text
      count += result.count
    },
    () => {
      const result = apply(CONN_URL, text, (_full, scheme, user, _password, host) => `${scheme}${user}:${REDACTED_PLACEHOLDER}@${host}`)
      text = result.text
      count += result.count
    }
  ]

  for (const step of steps) step()
  return { text, count }
}
