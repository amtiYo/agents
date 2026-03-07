import { createRequire } from 'node:module'

function loadCliVersion(): string {
  const require = createRequire(import.meta.url)
  try {
    const pkg = require('../../package.json') as { version?: unknown }
    if (typeof pkg.version === 'string' && pkg.version.trim().length > 0) {
      return pkg.version.trim()
    }
  } catch {
    // Fall back to a safe placeholder if package metadata is unavailable.
  }
  return '0.0.0'
}

export const CLI_VERSION = loadCliVersion()

