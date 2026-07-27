import os from 'node:os'
import path from 'node:path'
import { parseDocument } from 'yaml'

export interface HermesManagedState {
  configs: Record<string, string[]>
}

export interface ResolveHermesConfigPathOptions {
  profile: string | null
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

/** Resolve the single Hermes YAML file owned by the current workspace. */
export function resolveHermesConfigPath(
  options: ResolveHermesConfigPathOptions,
): string {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const explicit = env.AGENTS_HERMES_CONFIG_PATH?.trim()
  if (explicit) {
    return expandHome(explicit, homeDir)
  }

  const profile = options.profile?.trim()
  if (profile) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile) || profile === '.' || profile === '..') {
      throw new Error(`Invalid Hermes profile: ${profile}`)
    }
    return path.join(homeDir, '.hermes', 'profiles', profile, 'config.yaml')
  }

  const hermesHome = expandHome(
    env.HERMES_HOME?.trim() || path.join(homeDir, '.hermes'),
    homeDir,
  )
  return path.join(hermesHome, 'config.yaml')
}

/**
 * Merge Agent Sync-owned MCP servers into a Hermes config document while
 * preserving unrelated YAML nodes and comments.
 */
export function mergeHermesConfig(
  source: string,
  previousManagedNames: string[],
  nextServers: Record<string, Record<string, unknown>>,
): string {
  const document = parseDocument(source.trim() ? source : '{}\n')
  if (document.errors.length > 0) {
    throw new Error(`Failed to parse Hermes config: ${document.errors.map((error) => error.message).join('; ')}`)
  }

  const rootValue = document.toJS()
  if (!isRecord(rootValue)) {
    throw new Error('Failed to parse Hermes config: root must be a mapping')
  }

  if (!isRecord(rootValue.mcp_servers)) {
    document.set('mcp_servers', document.createNode({}))
  }

  const previous = [...new Set(previousManagedNames.filter((name) => typeof name === 'string'))]
  for (const name of previous) {
    document.deleteIn(['mcp_servers', name])
  }

  const nextNames = Object.keys(nextServers).sort((a, b) => a.localeCompare(b))
  for (const name of nextNames) {
    document.setIn(['mcp_servers', name], nextServers[name])
  }

  const platformToolsets = rootValue.platform_toolsets
  if (isRecord(platformToolsets)) {
    for (const [platform, rawEntries] of Object.entries(platformToolsets)) {
      if (!Array.isArray(rawEntries)) continue
      const filtered = rawEntries
        .map((entry) => String(entry))
        .filter((entry) => !previous.includes(entry))
      if (!filtered.includes('no_mcp')) {
        for (const name of nextNames) {
          if (!filtered.includes(name)) filtered.push(name)
        }
      }
      document.setIn(['platform_toolsets', platform], filtered)
    }
  }

  const rendered = document.toString()
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`
}

/** Normalize persisted Hermes ownership state without trusting its shape. */
export function normalizeHermesManagedState(value: unknown): HermesManagedState {
  if (!isRecord(value) || !isRecord(value.configs)) {
    return { configs: {} }
  }

  const configs: Record<string, string[]> = {}
  for (const [configPath, names] of Object.entries(value.configs)) {
    if (!Array.isArray(names)) continue
    const normalized = [...new Set(names.filter((name): name is string => typeof name === 'string'))]
      .sort((a, b) => a.localeCompare(b))
    configs[configPath] = normalized
  }
  return { configs }
}

function expandHome(value: string, homeDir: string): string {
  if (value === '~') return homeDir
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, value.slice(2))
  }
  return path.resolve(value)
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
