import path from 'node:path'
import { copyDir, ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { discoverSkills } from './skillsDiscovery.js'
import { getProjectPaths } from './paths.js'
import { loadAgentsConfig, saveAgentsConfig } from './config.js'
import { validateServerName } from './mcpValidation.js'
import type { McpServerDefinition, McpTransportType } from '../types.js'

export const PLUGIN_SPEC_VERSION = '1.0.0'
export const PLUGIN_MANIFEST_SCHEMA = `https://agent-plugins.org/schemas/${PLUGIN_SPEC_VERSION}/plugin.schema.json`
export const PLUGIN_MCP_SCHEMA = `https://agent-plugins.org/schemas/${PLUGIN_SPEC_VERSION}/mcp.schema.json`

/** Top-level manifest fields the specification allows; anything else is rejected. */
const ALLOWED_MANIFEST_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions'
])

const PLUGIN_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9]|[-.](?=[a-z0-9]))*$/

export interface PluginManifest {
  $schema: string
  name: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  extensions?: Record<string, unknown>
}

export interface PluginMcpFile {
  $schema: string
  mcpServers: Record<string, PluginMcpServer>
}

export interface PluginMcpServer {
  type: 'stdio' | 'streamable-http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

/** Validate a plugin name against the specification's character rules. */
export function validatePluginName(name: string): void {
  if (name.length < 1 || name.length > 64) {
    throw new Error(`Invalid plugin name "${name}": use 1-64 characters.`)
  }
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid plugin name "${name}": lowercase letters, digits, single hyphens and periods only, starting and ending with an alphanumeric.`,
    )
  }
}

/** Map an agents transport to the plugin spec's transport name. */
function toPluginTransport(transport: McpTransportType): PluginMcpServer['type'] {
  if (transport === 'stdio') return 'stdio'
  return transport === 'sse' ? 'sse' : 'streamable-http'
}

/**
 * Convert the committed server definitions into the plugin `mcp.json` shape.
 *
 * Values are taken from `.agents/agents.json` only, never from `.agents/local.json`,
 * so real secrets cannot reach an exported plugin: what ships is the `${VAR}`
 * placeholder the committed file already carries.
 */
export function buildPluginMcp(servers: Record<string, McpServerDefinition>): {
  file: PluginMcpFile
  warnings: string[]
  requiredEnv: string[]
} {
  const warnings: string[] = []
  const requiredEnv = new Set<string>()
  const mcpServers: Record<string, PluginMcpServer> = {}

  for (const name of Object.keys(servers).sort((a, b) => a.localeCompare(b))) {
    const server = servers[name]
    if (!server || server.enabled === false) continue

    // ${PLUGIN_ROOT} and ${PLUGIN_DATA} are expanded by the plugin client itself,
    // and ${PROJECT_ROOT} is rewritten above, so none of them is a required variable.
    const clientPlaceholders = new Set(['PROJECT_ROOT', 'PLUGIN_ROOT', 'PLUGIN_DATA'])
    const collectEnvRefs = (value: string | undefined): void => {
      if (!value) return
      for (const match of value.matchAll(/\$\{([A-Z0-9_]+)(?::-[^}]*)?\}/g)) {
        const key = match[1]
        if (key && !clientPlaceholders.has(key)) requiredEnv.add(key)
      }
    }

    if (server.transport === 'stdio') {
      if (!server.command) {
        warnings.push(`Server "${name}" has no command; skipped in the plugin.`)
        continue
      }
      const args = (server.args ?? []).map((arg) => arg.replaceAll('${PROJECT_ROOT}', '${PLUGIN_ROOT}'))
      args.forEach(collectEnvRefs)
      Object.values(server.env ?? {}).forEach(collectEnvRefs)
      mcpServers[name] = {
        type: 'stdio',
        command: server.command,
        ...(args.length > 0 ? { args } : {}),
        ...(server.env ? { env: { ...server.env } } : {}),
        ...(server.cwd ? { cwd: server.cwd.replaceAll('${PROJECT_ROOT}', '${PLUGIN_ROOT}') } : {})
      }
      continue
    }

    if (!server.url) {
      warnings.push(`Server "${name}" has no url; skipped in the plugin.`)
      continue
    }
    collectEnvRefs(server.url)
    Object.values(server.headers ?? {}).forEach(collectEnvRefs)
    if (server.transport === 'sse') {
      warnings.push(`Server "${name}" uses the deprecated sse transport; plugin clients may drop it within a year.`)
    }
    mcpServers[name] = {
      type: toPluginTransport(server.transport),
      url: server.url,
      ...(server.headers ? { headers: { ...server.headers } } : {})
    }
  }

  return {
    file: { $schema: PLUGIN_MCP_SCHEMA, mcpServers },
    warnings,
    requiredEnv: [...requiredEnv].sort()
  }
}

export interface ExportPluginOptions {
  projectRoot: string
  outDir: string
  name: string
  version?: string
  description?: string
  author?: string
  license?: string
}

export interface ExportPluginResult {
  outDir: string
  serverCount: number
  skillCount: number
  requiredEnv: string[]
  warnings: string[]
}

/** Write an Agent Plugins v1 package built from the project's `.agents` directory. */
export async function exportPlugin(options: ExportPluginOptions): Promise<ExportPluginResult> {
  validatePluginName(options.name)

  const paths = getProjectPaths(options.projectRoot)
  const config = await loadAgentsConfig(options.projectRoot)
  const { file, warnings, requiredEnv } = buildPluginMcp(config.mcp.servers)

  const manifest: PluginManifest = {
    $schema: PLUGIN_MANIFEST_SCHEMA,
    name: options.name,
    ...(options.version ? { version: options.version } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.author ? { author: options.author } : {}),
    ...(options.license ? { license: options.license } : {})
  }

  const outDir = path.resolve(options.outDir)
  await ensureDir(outDir)
  await writeJsonAtomic(path.join(outDir, 'plugin.json'), manifest)
  await writeJsonAtomic(path.join(outDir, 'mcp.json'), file)

  let skillCount = 0
  if (await pathExists(paths.agentsSkillsDir)) {
    const discovery = await discoverSkills(paths.agentsSkillsDir)
    skillCount = discovery.skills.length
    if (skillCount > 0) {
      await copyDir(paths.agentsSkillsDir, path.join(outDir, 'skills'), { dereference: true })
    }
    for (const duplicate of discovery.duplicates) {
      warnings.push(`Skill name "${duplicate.name}" is duplicated; plugin clients expect unique skill names.`)
    }
  }

  return {
    outDir,
    serverCount: Object.keys(file.mcpServers).length,
    skillCount,
    requiredEnv,
    warnings
  }
}

export interface ValidatePluginResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  serverCount: number
  skillCount: number
}

/** Check a plugin directory against the Agent Plugins v1 rules. */
export async function validatePlugin(pluginDir: string): Promise<ValidatePluginResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const dir = path.resolve(pluginDir)

  const manifestPath = path.join(dir, 'plugin.json')
  if (!(await pathExists(manifestPath))) {
    return { ok: false, errors: [`Missing ${manifestPath}`], warnings, serverCount: 0, skillCount: 0 }
  }

  let manifest: Record<string, unknown>
  try {
    manifest = await readJson<Record<string, unknown>>(manifestPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, errors: [`plugin.json is not valid JSON: ${message}`], warnings, serverCount: 0, skillCount: 0 }
  }

  if (manifest.$schema !== PLUGIN_MANIFEST_SCHEMA) {
    errors.push(`plugin.json $schema must be "${PLUGIN_MANIFEST_SCHEMA}"`)
  }
  if (typeof manifest.name !== 'string') {
    errors.push('plugin.json is missing the required "name" field')
  } else {
    try {
      validatePluginName(manifest.name)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_MANIFEST_FIELDS.has(key)) {
      errors.push(`plugin.json has field "${key}", which the specification does not allow at the top level`)
    }
  }

  let serverCount = 0
  const mcpPath = path.join(dir, 'mcp.json')
  if (await pathExists(mcpPath)) {
    try {
      const mcp = await readJson<Record<string, unknown>>(mcpPath)
      if (mcp.$schema !== PLUGIN_MCP_SCHEMA) {
        errors.push(`mcp.json $schema must be "${PLUGIN_MCP_SCHEMA}"`)
      }
      const servers = mcp.mcpServers
      if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
        errors.push('mcp.json is missing the required "mcpServers" object')
      } else {
        for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
          serverCount += 1
          if (typeof raw !== 'object' || raw === null) {
            errors.push(`mcp.json server "${name}" is not an object`)
            continue
          }
          const server = raw as PluginMcpServer
          if (server.type === 'stdio') {
            if (!server.command) {
              errors.push(`mcp.json server "${name}" is stdio but has no command`)
            } else if (/[\\/]/.test(server.command) && !server.command.startsWith('./')) {
              errors.push(`mcp.json server "${name}" command must be a bare name or a ./-relative path`)
            }
          } else if (server.type === 'streamable-http' || server.type === 'sse') {
            if (!server.url) {
              errors.push(`mcp.json server "${name}" is remote but has no url`)
            } else if (server.url.includes('#')) {
              errors.push(`mcp.json server "${name}" url must not contain a fragment`)
            }
            if (server.type === 'sse') {
              warnings.push(`mcp.json server "${name}" uses the deprecated sse transport`)
            }
          } else {
            errors.push(`mcp.json server "${name}" has unsupported type "${String(server.type)}"`)
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`mcp.json is not valid JSON: ${message}`)
    }
  }

  let skillCount = 0
  const skillsDir = path.join(dir, 'skills')
  if (await pathExists(skillsDir)) {
    const discovery = await discoverSkills(skillsDir)
    skillCount = discovery.skills.length
    for (const duplicate of discovery.duplicates) {
      errors.push(`Skill name "${duplicate.name}" appears more than once`)
    }
  }

  if (serverCount === 0 && skillCount === 0) {
    errors.push('A plugin must provide at least one skill or MCP server')
  }

  return { ok: errors.length === 0, errors, warnings, serverCount, skillCount }
}

export interface ImportPluginResult {
  addedServers: string[]
  skippedServers: string[]
  addedSkills: string[]
  warnings: string[]
}

/**
 * Add a plugin's MCP servers and skills to the project.
 *
 * Names are prefixed with the plugin name so an imported package never silently
 * replaces a server the project already defines.
 */
export async function importPlugin(args: {
  projectRoot: string
  pluginDir: string
  prefix?: string
}): Promise<ImportPluginResult> {
  const dir = path.resolve(args.pluginDir)
  const validation = await validatePlugin(dir)
  if (!validation.ok) {
    throw new Error(`Plugin at ${dir} is not valid: ${validation.errors.join('; ')}`)
  }

  const manifest = await readJson<PluginManifest>(path.join(dir, 'plugin.json'))
  const prefix = args.prefix ?? manifest.name
  const warnings: string[] = [...validation.warnings]
  const addedServers: string[] = []
  const skippedServers: string[] = []

  const paths = getProjectPaths(args.projectRoot)
  const config = await loadAgentsConfig(args.projectRoot)

  const mcpPath = path.join(dir, 'mcp.json')
  if (await pathExists(mcpPath)) {
    const mcp = await readJson<PluginMcpFile>(mcpPath)
    for (const [name, server] of Object.entries(mcp.mcpServers ?? {})) {
      const targetName = prefix ? `${prefix}.${name}` : name
      try {
        validateServerName(targetName)
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error))
        skippedServers.push(targetName)
        continue
      }
      if (config.mcp.servers[targetName]) {
        skippedServers.push(targetName)
        continue
      }
      config.mcp.servers[targetName] = server.type === 'stdio'
        ? {
            transport: 'stdio',
            command: server.command ?? '',
            ...(server.args ? { args: server.args.map((arg) => arg.replaceAll('${PLUGIN_ROOT}', dir)) } : {}),
            ...(server.env ? { env: server.env } : {}),
            ...(server.cwd ? { cwd: server.cwd.replaceAll('${PLUGIN_ROOT}', dir) } : {})
          }
        : {
            transport: server.type === 'sse' ? 'sse' : 'http',
            url: server.url ?? '',
            ...(server.headers ? { headers: server.headers } : {})
          }
      addedServers.push(targetName)
    }
  }

  const addedSkills: string[] = []
  const pluginSkills = path.join(dir, 'skills')
  if (await pathExists(pluginSkills)) {
    const discovery = await discoverSkills(pluginSkills)
    for (const skill of discovery.skills) {
      const targetDir = path.join(paths.agentsSkillsDir, skill.name)
      if (await pathExists(targetDir)) {
        warnings.push(`Skill "${skill.name}" already exists in .agents/skills; left untouched.`)
        continue
      }
      await copyDir(path.dirname(skill.skillFilePath), targetDir, { dereference: true })
      addedSkills.push(skill.name)
    }
  }

  await saveAgentsConfig(args.projectRoot, config)

  return { addedServers, skippedServers, addedSkills, warnings }
}
