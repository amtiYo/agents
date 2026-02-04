import os from 'node:os'
import path from 'node:path'
import TOML from '@iarna/toml'
import { ensureDir, pathExists, readTextOrEmpty, writeTextAtomic } from './fs.js'

type CodexConfig = {
  projects?: Record<string, { trust_level?: string } & Record<string, unknown>>
} & Record<string, unknown>

export type CodexTrustState = 'trusted' | 'untrusted'

export function getCodexConfigPath(): string {
  const override = process.env.AGENTS_CODEX_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override)
  }
  return path.join(os.homedir(), '.codex', 'config.toml')
}

export async function getCodexTrustState(projectRoot: string): Promise<CodexTrustState> {
  const configPath = getCodexConfigPath()
  if (!(await pathExists(configPath))) return 'untrusted'

  const raw = await readTextOrEmpty(configPath)
  if (raw.trim().length === 0) return 'untrusted'

  let parsed: CodexConfig
  try {
    parsed = TOML.parse(raw) as CodexConfig
  } catch {
    return 'untrusted'
  }

  const projectKey = path.resolve(projectRoot)
  const trustLevel = parsed.projects?.[projectKey]?.trust_level
  return trustLevel === 'trusted' ? 'trusted' : 'untrusted'
}

export async function ensureCodexProjectTrusted(projectRoot: string): Promise<{ changed: boolean; path: string }> {
  const configPath = getCodexConfigPath()
  const projectKey = path.resolve(projectRoot)
  const raw = await readTextOrEmpty(configPath)

  let parsed: CodexConfig = {}
  if (raw.trim().length > 0) {
    parsed = TOML.parse(raw) as CodexConfig
  }

  const current = parsed.projects?.[projectKey]?.trust_level
  if (current === 'trusted') {
    return { changed: false, path: configPath }
  }

  const projects = parsed.projects ?? {}
  const existing = projects[projectKey] ?? {}
  projects[projectKey] = { ...existing, trust_level: 'trusted' }
  parsed.projects = projects

  const rendered = TOML.stringify(parsed as unknown as TOML.JsonMap)
  await ensureDir(path.dirname(configPath))
  await writeTextAtomic(configPath, rendered)
  return { changed: true, path: configPath }
}
