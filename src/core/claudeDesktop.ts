import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathExists, readJson, writeJsonAtomic } from './fs.js'
import { MANAGED_CLAUDE_NAME_PREFIX } from '../integrations/claude.js'

export interface ClaudeDesktopConfigPayload {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

export function getClaudeDesktopConfigPath(): string | undefined {
  const override = process.env.AGENTS_CLAUDE_DESKTOP_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA && process.env.APPDATA.trim().length > 0
      ? process.env.APPDATA
      : path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Claude', 'claude_desktop_config.json')
  }

  return undefined
}

export function getClaudeDesktopConfigUnavailableDetail(): string {
  return 'Claude Desktop config path is only known on macOS and Windows. Set AGENTS_CLAUDE_DESKTOP_CONFIG_PATH to override.'
}

export function getClaudeDesktopManagedPrefix(projectRoot: string): string {
  const normalizedRoot = path.resolve(projectRoot)
  const hash = createHash('sha1').update(normalizedRoot).digest('hex').slice(0, 12)
  return `${MANAGED_CLAUDE_NAME_PREFIX}${hash}__`
}

export function toManagedClaudeDesktopName(projectRoot: string, serverName: string): string {
  return `${getClaudeDesktopManagedPrefix(projectRoot)}${serverName}`
}

export function isManagedClaudeDesktopNameForProject(projectRoot: string, serverName: string): boolean {
  return serverName.startsWith(getClaudeDesktopManagedPrefix(projectRoot))
}

export async function readClaudeDesktopConfig(pathToRead: string): Promise<ClaudeDesktopConfigPayload | undefined> {
  if (!(await pathExists(pathToRead))) return undefined
  return readJson<ClaudeDesktopConfigPayload>(pathToRead)
}

export async function writeClaudeDesktopConfig(
  pathToWrite: string,
  payload: ClaudeDesktopConfigPayload,
): Promise<void> {
  await writeJsonAtomic(pathToWrite, normalizeClaudeDesktopConfig(payload))
}

export function normalizeClaudeDesktopConfig(
  payload: ClaudeDesktopConfigPayload,
): ClaudeDesktopConfigPayload {
  return {
    ...payload,
    mcpServers: isRecord(payload.mcpServers) ? payload.mcpServers : {}
  }
}

export function mergeClaudeDesktopConfig(args: {
  projectRoot: string
  existing?: ClaudeDesktopConfigPayload
  managedServers: Record<string, unknown>
}): ClaudeDesktopConfigPayload {
  const normalizedExisting = normalizeClaudeDesktopConfig(args.existing ?? {})
  const preservedServers = Object.entries(normalizedExisting.mcpServers ?? {})
    .filter(([name]) => !isManagedClaudeDesktopNameForProject(args.projectRoot, name))

  const nextServers: Record<string, unknown> = {}
  for (const [name, value] of preservedServers) {
    nextServers[name] = value
  }
  for (const name of Object.keys(args.managedServers).sort((a, b) => a.localeCompare(b))) {
    nextServers[name] = args.managedServers[name]
  }

  return {
    ...normalizedExisting,
    mcpServers: nextServers
  }
}

export function listClaudeDesktopManagedServerNames(
  payload: ClaudeDesktopConfigPayload,
  projectRoot?: string,
): string[] {
  const prefix = projectRoot ? getClaudeDesktopManagedPrefix(projectRoot) : MANAGED_CLAUDE_NAME_PREFIX
  return Object.keys(normalizeClaudeDesktopConfig(payload).mcpServers ?? {})
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
