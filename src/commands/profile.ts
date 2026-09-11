import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import * as ui from '../core/ui.js'
import type { AgentsConfig } from '../types.js'

export interface ProfileListOptions {
  projectRoot: string
  json: boolean
}

/** Names of the configured profiles, sorted for stable output. */
function profileNames(config: AgentsConfig): string[] {
  return Object.keys(config.profiles ?? {}).sort((a, b) => a.localeCompare(b))
}

/** Show the configured profiles and which one is active. */
export async function runProfileList(options: ProfileListOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)
  const names = profileNames(config)

  if (options.json) {
    ui.json({
      active: config.activeProfile ?? null,
      profiles: Object.fromEntries(names.map((name) => [name, config.profiles?.[name]]))
    })
    return
  }

  if (names.length === 0) {
    ui.info('No profiles defined.')
    ui.hint('Add one with: agents profile set <name> --server <name> --server <name>')
    return
  }

  ui.keyValue('Active', config.activeProfile ?? '(all servers)')
  ui.blank()
  for (const name of names) {
    const profile = config.profiles?.[name]
    const marker = name === config.activeProfile ? '*' : ' '
    ui.writeln(`${marker} ${name}: ${ui.formatList(profile?.servers ?? [])}`)
    if (profile?.description) {
      ui.dim(`   ${profile.description}`)
    }
  }
}

export interface ProfileSetOptions {
  projectRoot: string
  name: string
  servers: string[]
  description?: string
  sync?: boolean
  json: boolean
}

/** Create or replace a profile: a named subset of the configured MCP servers. */
export async function runProfileSet(options: ProfileSetOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)

  const unknown = options.servers.filter((server) => !config.mcp.servers[server])
  if (unknown.length > 0) {
    throw new Error(`Unknown MCP server(s): ${unknown.join(', ')}. Configured: ${Object.keys(config.mcp.servers).join(', ')}`)
  }

  const wasActive = config.activeProfile === options.name
  config.profiles = {
    ...config.profiles,
    [options.name]: {
      ...(options.description ? { description: options.description } : {}),
      servers: [...new Set(options.servers)].sort((a, b) => a.localeCompare(b))
    }
  }
  await saveAgentsConfig(options.projectRoot, config)

  // Replacing the active profile changes the server set, and tool configs still hold
  // the previous one until a sync runs.
  const shouldSync = wasActive && options.sync !== false
  const result = shouldSync
    ? await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
    : { changed: [], warnings: [] }

  if (options.json) {
    ui.json({
      name: options.name,
      profile: config.profiles[options.name],
      changed: result.changed,
      warnings: result.warnings
    })
    return
  }
  ui.success(`Profile "${options.name}" saved with ${ui.formatCount(options.servers.length, 'server', 'servers')}`)
  if (shouldSync) {
    ui.keyValue('Updated files', String(result.changed.length))
    // A sync can skip a tool config and say why; hiding that would make the save look
    // more complete than it is.
    for (const warning of result.warnings) {
      ui.warning(warning)
    }
  } else if (wasActive) {
    ui.hint('It is the active profile. Run agents sync to apply the new set.')
  } else {
    ui.hint(`Activate it with: agents profile use ${options.name}`)
  }
}

export interface ProfileUseOptions {
  projectRoot: string
  name: string | null
  sync: boolean
  json: boolean
}

/** Switch the active profile (or clear it) and re-sync so tool configs follow. */
export async function runProfileUse(options: ProfileUseOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)

  if (options.name !== null && !config.profiles?.[options.name]) {
    throw new Error(`Profile "${options.name}" is not defined. Known profiles: ${profileNames(config).join(', ') || '(none)'}`)
  }

  config.activeProfile = options.name
  await saveAgentsConfig(options.projectRoot, config)

  const result = options.sync
    ? await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
    : { changed: [], warnings: [] }

  if (options.json) {
    ui.json({ active: config.activeProfile, changed: result.changed, warnings: result.warnings })
    return
  }

  ui.success(options.name === null ? 'Profile cleared; every server is active' : `Active profile: ${options.name}`)
  if (options.sync) {
    ui.keyValue('Updated files', String(result.changed.length))
    for (const warning of result.warnings) {
      ui.warning(warning)
    }
  } else {
    ui.hint('Run agents sync to apply it to tool configs.')
  }
}

export interface ProfileRemoveOptions {
  projectRoot: string
  name: string
  sync?: boolean
  json: boolean
}

/**
 * Delete a profile, re-syncing when it was the active one so tool configs widen back
 * to every server.
 */
export async function runProfileRemove(options: ProfileRemoveOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)
  if (!config.profiles?.[options.name]) {
    throw new Error(`Profile "${options.name}" is not defined.`)
  }

  const wasActive = config.activeProfile === options.name
  const { [options.name]: _removed, ...rest } = config.profiles
  config.profiles = Object.keys(rest).length > 0 ? rest : undefined
  if (wasActive) {
    config.activeProfile = null
  }
  await saveAgentsConfig(options.projectRoot, config)

  // Removing the active profile widens the server set, and tool configs still hold the
  // narrow one until a sync runs.
  const shouldSync = wasActive && options.sync !== false
  const result = shouldSync
    ? await performSync({ projectRoot: options.projectRoot, check: false, verbose: false })
    : { changed: [], warnings: [] }

  if (options.json) {
    ui.json({
      removed: options.name,
      active: config.activeProfile ?? null,
      changed: result.changed,
      warnings: result.warnings
    })
    return
  }
  ui.success(`Profile "${options.name}" removed`)
  if (shouldSync) {
    ui.keyValue('Updated files', String(result.changed.length))
    for (const warning of result.warnings) {
      ui.warning(warning)
    }
  } else if (wasActive) {
    ui.hint('It was the active profile. Run agents sync to restore every server in tool configs.')
  }
}
