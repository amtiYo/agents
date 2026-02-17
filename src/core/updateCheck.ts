import os from 'node:os'
import path from 'node:path'
import { pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { UpdateCheckMetadata } from '../types.js'
import * as ui from './ui.js'

const NPM_LATEST_URL = 'https://registry.npmjs.org/@agents-dev/cli/latest'
const DEFAULT_TIMEOUT_MS = 1500
const STARTUP_RECHECK_MS = 6 * 60 * 60 * 1000

export const UPGRADE_COMMAND = 'npm install -g @agents-dev/cli@latest'

type UpdateSource = 'network' | 'cache' | 'cache-stale' | 'unavailable'
type StorageKind = 'project-local' | 'global'

interface StorageState {
  kind: StorageKind
  filePath: string
  document: Record<string, unknown>
}

export interface UpdateStatus {
  currentVersion: string
  latestVersion: string | null
  isOutdated: boolean
  upgradeCommand: string
  checkedAt: string
  source: UpdateSource
  error?: string
}

export interface CheckForUpdatesOptions {
  currentVersion: string
  projectRoot?: string
  forceRefresh?: boolean
  timeoutMs?: number
  markNotifiedIfOutdated?: boolean
}

export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<UpdateStatus> {
  const now = new Date()
  const nowIso = now.toISOString()
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const storage = await loadStorageState(options.projectRoot)
  const metadata = readUpdateMetadata(storage.document)
  const channel = resolveUpdateChannel()

  if (!channel.ok) {
    metadata.lastSeenVersion = options.currentVersion
    writeUpdateMetadata(storage.document, storage.kind, metadata)
    await writeJsonAtomic(storage.filePath, storage.document)
    return {
      currentVersion: options.currentVersion,
      latestVersion: normalizeVersion(metadata.latestVersion),
      isOutdated: false,
      upgradeCommand: UPGRADE_COMMAND,
      checkedAt: metadata.lastCheckedAt ?? nowIso,
      source: 'unavailable',
      error: channel.error
    }
  }

  let source: UpdateSource = 'cache'
  let latestVersion = normalizeVersion(metadata.latestVersion)
  let errorMessage: string | undefined

  const shouldRefresh = options.forceRefresh === true || !isRecent(metadata.lastCheckedAt, STARTUP_RECHECK_MS)
  if (!latestVersion || shouldRefresh) {
    const fetched = await fetchLatestVersion(timeoutMs)
    if (fetched.version) {
      latestVersion = fetched.version
      metadata.latestVersion = fetched.version
      metadata.lastCheckedAt = nowIso
      source = 'network'
    } else if (latestVersion) {
      source = 'cache-stale'
      errorMessage = fetched.error
    } else {
      source = 'unavailable'
      errorMessage = fetched.error
    }
  }

  metadata.lastSeenVersion = options.currentVersion
  const isOutdated = compareVersions(options.currentVersion, latestVersion) < 0
  if (isOutdated && options.markNotifiedIfOutdated) {
    metadata.lastNotifiedAt = nowIso
  }
  writeUpdateMetadata(storage.document, storage.kind, metadata)
  await writeJsonAtomic(storage.filePath, storage.document)

  return {
    currentVersion: options.currentVersion,
    latestVersion,
    isOutdated,
    upgradeCommand: UPGRADE_COMMAND,
    checkedAt: metadata.lastCheckedAt ?? nowIso,
    source,
    error: errorMessage
  }
}

export async function maybeNotifyAboutUpdate(args: {
  currentVersion: string
  projectRoot?: string
}): Promise<void> {
  try {
    const status = await checkForUpdates({
      currentVersion: args.currentVersion,
      projectRoot: args.projectRoot,
      markNotifiedIfOutdated: true
    })
    if (!status.isOutdated || !status.latestVersion) return

    ui.blank()
    ui.warning(`Update available: ${status.currentVersion} -> ${status.latestVersion}`)
    ui.hint(`Run "${status.upgradeCommand}"`)
  } catch {
    // Update checks should never block command execution.
  }
}

async function loadStorageState(projectRoot: string | undefined): Promise<StorageState> {
  const projectLocalPath = projectRoot ? getProjectPaths(projectRoot).agentsLocal : undefined
  if (projectLocalPath && (await pathExists(projectLocalPath))) {
    return {
      kind: 'project-local',
      filePath: projectLocalPath,
      document: await readDocument(projectLocalPath)
    }
  }

  const globalPath = path.join(os.homedir(), '.agents-dev', 'update-check.json')
  return {
    kind: 'global',
    filePath: globalPath,
    document: await readDocument(globalPath)
  }
}

async function readDocument(filePath: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(filePath))) return {}
  try {
    const parsed = await readJson<Record<string, unknown>>(filePath)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function readUpdateMetadata(document: Record<string, unknown>): UpdateCheckMetadata {
  const meta = asObject(document.meta)
  const updateCheck = asObject(meta?.updateCheck)
  return {
    lastCheckedAt: asString(updateCheck?.lastCheckedAt),
    lastSeenVersion: asString(updateCheck?.lastSeenVersion),
    lastNotifiedAt: asString(updateCheck?.lastNotifiedAt),
    latestVersion: asString(updateCheck?.latestVersion)
  }
}

function writeUpdateMetadata(
  document: Record<string, unknown>,
  kind: StorageKind,
  metadata: UpdateCheckMetadata,
): void {
  if (kind === 'project-local' && !asObject(document.mcpServers)) {
    document.mcpServers = {}
  }

  const meta = asObject(document.meta) ?? {}
  meta.updateCheck = {
    ...(asObject(meta.updateCheck) ?? {}),
    ...metadata
  }
  document.meta = meta
}

async function fetchLatestVersion(timeoutMs: number): Promise<{ version: string | null; error?: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(NPM_LATEST_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) {
      return { version: null, error: `registry request failed (${response.status})` }
    }

    const payload = await response.json() as { version?: unknown }
    const version = normalizeVersion(typeof payload.version === 'string' ? payload.version : null)
    if (!version) {
      return { version: null, error: 'invalid registry response' }
    }
    return { version }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { version: null, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeTimeout(input: number | undefined): number {
  if (!Number.isFinite(input)) return DEFAULT_TIMEOUT_MS
  if (!input || input <= 0) return DEFAULT_TIMEOUT_MS
  return Math.floor(input)
}

function isRecent(value: string | undefined, thresholdMs: number): boolean {
  if (!value) return false
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return Date.now() - parsed <= thresholdMs
}

function normalizeVersion(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed
}

function compareVersions(current: string, latest: string | null): number {
  if (!latest) return 0
  const a = parseSemver(current)
  const b = parseSemver(latest)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i += 1) {
    if (a[i] === b[i]) continue
    return a[i] < b[i] ? -1 : 1
  }
  return 0
}

function parseSemver(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  const major = Number.parseInt(match[1], 10)
  const minor = Number.parseInt(match[2], 10)
  const patch = Number.parseInt(match[3], 10)
  if (![major, minor, patch].every((part) => Number.isInteger(part))) {
    return null
  }
  return [major, minor, patch]
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function resolveUpdateChannel(): { ok: true; value: 'stable' } | { ok: false; error: string } {
  const raw = (process.env.AGENTS_UPDATE_CHANNEL ?? 'stable').trim().toLowerCase()
  if (!raw || raw === 'stable') {
    return { ok: true, value: 'stable' }
  }
  return {
    ok: false,
    error: `unsupported update channel "${raw}" (only "stable" is currently supported)`
  }
}
