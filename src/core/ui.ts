/**
 * Unified UI module for @agents-dev/cli
 *
 * Provides consistent formatting, colors, and symbols across all commands.
 * Features:
 * - Unicode symbols with ASCII fallback
 * - Minimalist colors (only for status indicators)
 * - Context-aware output (respects --json, NO_COLOR)
 * - Spinner wrapper for async operations
 */

import * as clack from '@clack/prompts'
import color from 'picocolors'

// ---------------------------------------------------------------------------
// Terminal Detection
// ---------------------------------------------------------------------------

/**
 * Detect if terminal supports Unicode characters
 */
function detectUnicodeSupport(): boolean {
  // Windows Terminal and modern terminals support Unicode
  if (process.env.WT_SESSION) return true
  if (process.env.TERM_PROGRAM === 'vscode') return true
  if (process.env.TERM_PROGRAM === 'iTerm.app') return true
  if (process.env.TERM_PROGRAM === 'Apple_Terminal') return true

  // Check locale settings
  const locale = (process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? '').toLowerCase()
  if (locale.includes('utf-8') || locale.includes('utf8')) return true

  // Check TERM
  const term = (process.env.TERM ?? '').toLowerCase()
  if (term.includes('xterm') || term.includes('256color') || term.includes('kitty') || term.includes('alacritty')) {
    return true
  }

  // CI environments usually support Unicode
  if (process.env.CI) return true

  // Default to ASCII for unknown terminals
  return false
}

/**
 * Check if colors should be disabled
 */
function isNoColor(): boolean {
  return Boolean(process.env.NO_COLOR) || process.argv.includes('--no-color')
}

/**
 * Check if we're in a TTY (interactive terminal)
 */
function isTTY(): boolean {
  return Boolean(process.stdout.isTTY)
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const UNICODE_SYMBOLS = {
  success: '\u2713', // ✓
  error: '\u2717', // ✗
  warning: '\u26a0', // ⚠
  info: '\u25cb', // ○
  bullet: '\u2022', // •
  arrow: '\u2192', // →
  ellipsis: '\u2026' // …
} as const

const ASCII_SYMBOLS = {
  success: '[ok]',
  error: '[error]',
  warning: '[warn]',
  info: '[info]',
  bullet: '-',
  arrow: '->',
  ellipsis: '...'
} as const

const supportsUnicode = detectUnicodeSupport()

export const symbols = supportsUnicode ? UNICODE_SYMBOLS : ASCII_SYMBOLS

// ---------------------------------------------------------------------------
// UI Context
// ---------------------------------------------------------------------------

interface UIContext {
  json: boolean
  quiet: boolean
  noColor: boolean
}

const context: UIContext = {
  json: false,
  quiet: false,
  noColor: isNoColor()
}

/**
 * Set UI context flags (call at command start)
 */
export function setContext(options: Partial<UIContext>): void {
  if (options.json !== undefined) context.json = options.json
  if (options.quiet !== undefined) context.quiet = options.quiet
  if (options.noColor !== undefined) context.noColor = options.noColor
}

/**
 * Reset UI context to defaults
 */
export function resetContext(): void {
  context.json = false
  context.quiet = false
  context.noColor = isNoColor()
}

/**
 * Check if output should be suppressed
 */
function shouldSuppress(): boolean {
  return context.json || context.quiet
}

// ---------------------------------------------------------------------------
// Color Helpers
// ---------------------------------------------------------------------------

function applyColor(fn: (s: string) => string, text: string): string {
  if (context.noColor) return text
  return fn(text)
}

const colors = {
  success: (s: string) => applyColor(color.green, s),
  error: (s: string) => applyColor(color.red, s),
  warning: (s: string) => applyColor(color.yellow, s),
  info: (s: string) => applyColor(color.cyan, s),
  dim: (s: string) => applyColor(color.dim, s),
  bold: (s: string) => applyColor(color.bold, s)
}

// ---------------------------------------------------------------------------
// Output Functions
// ---------------------------------------------------------------------------

/**
 * Write raw text to stdout
 */
export function write(text: string): void {
  if (shouldSuppress()) return
  process.stdout.write(text)
}

/**
 * Write a line to stdout
 */
export function writeln(text: string = ''): void {
  write(`${text}\n`)
}

/**
 * Output success message: ✓ message (green)
 */
export function success(message: string): void {
  if (shouldSuppress()) return
  writeln(`${colors.success(symbols.success)} ${message}`)
}

/**
 * Output error message: ✗ message (red)
 */
export function error(message: string): void {
  if (shouldSuppress()) return
  writeln(`${colors.error(symbols.error)} ${message}`)
}

/**
 * Output warning message: ⚠ message (yellow)
 */
export function warning(message: string): void {
  if (shouldSuppress()) return
  writeln(`${colors.warning(symbols.warning)} ${message}`)
}

/**
 * Output info message: ○ message (cyan)
 */
export function info(message: string): void {
  if (shouldSuppress()) return
  writeln(`${colors.info(symbols.info)} ${message}`)
}

/**
 * Output dim/secondary text
 */
export function dim(message: string): void {
  if (shouldSuppress()) return
  writeln(colors.dim(message))
}

/**
 * Output a blank line
 */
export function blank(): void {
  if (shouldSuppress()) return
  writeln()
}

// ---------------------------------------------------------------------------
// Layout Helpers
// ---------------------------------------------------------------------------

/**
 * Output key-value pair with aligned formatting
 * Example: "Project:      /path/to/project"
 */
export function keyValue(key: string, value: string, keyWidth: number = 14): void {
  if (shouldSuppress()) return
  const paddedKey = key.padEnd(keyWidth)
  writeln(`${paddedKey} ${value}`)
}

/**
 * Output a bulleted list
 * Example:
 *   • item1
 *   • item2
 */
export function list(items: string[], indent: number = 2): void {
  if (shouldSuppress()) return
  const padding = ' '.repeat(indent)
  for (const item of items) {
    writeln(`${padding}${symbols.bullet} ${item}`)
  }
}

/**
 * Output a list with status indicators
 * Example:
 *   ✓ file1.json
 *   ✗ file2.json (missing)
 */
export function statusList(
  items: Array<{ label: string; ok: boolean; detail?: string }>,
  indent: number = 2
): void {
  if (shouldSuppress()) return
  const padding = ' '.repeat(indent)
  for (const item of items) {
    const symbol = item.ok ? colors.success(symbols.success) : colors.error(symbols.error)
    const detail = item.detail ? colors.dim(` (${item.detail})`) : ''
    writeln(`${padding}${symbol} ${item.label}${detail}`)
  }
}

/**
 * Output a section with title
 * Example:
 *   Files:
 *     ✓ config.json
 *     ✗ local.json
 */
export function section(title: string, content: string[] | (() => void)): void {
  if (shouldSuppress()) return
  writeln(`${title}:`)
  if (typeof content === 'function') {
    content()
  } else {
    for (const line of content) {
      writeln(`  ${line}`)
    }
  }
}

/**
 * Output items with arrow prefix (for "changed" lists)
 * Example:
 *   → file1.json
 *   → file2.json
 */
export function arrowList(items: string[], indent: number = 2): void {
  if (shouldSuppress()) return
  const padding = ' '.repeat(indent)
  for (const item of items) {
    writeln(`${padding}${colors.dim(symbols.arrow)} ${item}`)
  }
}

/**
 * Output a hint/help message
 */
export function hint(message: string): void {
  if (shouldSuppress()) return
  writeln(colors.dim(`Hint: ${message}`))
}

/**
 * Output next steps
 */
export function nextSteps(message: string): void {
  if (shouldSuppress()) return
  writeln(`Next: ${message}`)
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export interface Spinner {
  start: (message?: string) => void
  stop: (message?: string) => void
  message: (message: string) => void
}

/**
 * Create a spinner for async operations
 * Returns a no-op spinner if in JSON mode or non-TTY
 */
export function spinner(): Spinner {
  // No spinner in JSON mode or non-TTY
  if (context.json || context.quiet || !isTTY()) {
    return {
      start: () => {},
      stop: () => {},
      message: () => {}
    }
  }

  const spin = clack.spinner()
  return {
    start: (message?: string) => spin.start(message ?? 'Working...'),
    stop: (message?: string) => spin.stop(message ?? 'Done'),
    message: (message: string) => spin.message(message)
  }
}

// ---------------------------------------------------------------------------
// JSON Output
// ---------------------------------------------------------------------------

/**
 * Output JSON and exit (for --json flag handling)
 */
export function json<T>(data: T): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Formatting Utilities
// ---------------------------------------------------------------------------

/**
 * Format a count with singular/plural label
 * Example: formatCount(1, 'file', 'files') => '1 file'
 * Example: formatCount(3, 'file', 'files') => '3 files'
 */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Format a list of items with "none" fallback
 * Example: formatList(['a', 'b']) => 'a, b'
 * Example: formatList([]) => '(none)'
 */
export function formatList(items: string[], fallback: string = '(none)'): string {
  return items.length > 0 ? items.join(', ') : fallback
}

/**
 * Format enabled/disabled status
 */
export function formatEnabled(enabled: boolean): string {
  return enabled ? 'enabled' : 'disabled'
}

/**
 * Format ok/missing status for files
 */
export function formatExists(exists: boolean): string {
  if (exists) {
    return colors.success(symbols.success)
  }
  return `${colors.error(symbols.error)} ${colors.dim('(missing)')}`
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { color, clack }
