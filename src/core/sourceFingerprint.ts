import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { readTextOrEmpty } from './fs.js'
import { getProjectPaths } from './paths.js'
import type { AgentsConfig } from '../types.js'

export async function computeSharedSourceFingerprint(projectRoot: string, config: AgentsConfig): Promise<string> {
  const hash = createHash('sha256')
  const normalizedConfig = normalizeConfigForFingerprint(config)
  const paths = getProjectPaths(projectRoot)

  hash.update(JSON.stringify(normalizedConfig))
  hash.update('\n--AGENTS.md--\n')
  hash.update(await readTextOrEmpty(paths.rootAgentsMd))
  hash.update('\n--skills--\n')
  await hashDirectory(hash, paths.agentsSkillsDir, paths.agentsSkillsDir)

  return hash.digest('hex')
}

function normalizeConfigForFingerprint(config: AgentsConfig): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
  delete clone.lastSync
  delete clone.lastSyncSourceHash
  return clone
}

async function hashDirectory(
  hash: ReturnType<typeof createHash>,
  directoryPath: string,
  basePath: string,
): Promise<void> {
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch {
    return
  }

  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    const relativePath = path.relative(basePath, entryPath).replaceAll(path.sep, '/')

    if (entry.isDirectory()) {
      hash.update(`dir:${relativePath}\n`)
      await hashDirectory(hash, entryPath, basePath)
      continue
    }

    if (!entry.isFile()) continue

    hash.update(`file:${relativePath}\n`)
    hash.update(await readFile(entryPath))
    hash.update('\n')
  }
}
