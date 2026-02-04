import path from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { performSync } from '../core/sync.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists } from '../core/fs.js'

export interface WatchOptions {
  projectRoot: string
  intervalMs: number
  once: boolean
  quiet: boolean
}

export async function runWatch(options: WatchOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const intervalMs = normalizeInterval(options.intervalMs)

  if (options.once) {
    await runSingleSync(projectRoot, options.quiet)
    return
  }

  process.stdout.write(`Watching .agents files in ${projectRoot} (interval ${intervalMs}ms)\n`)
  process.stdout.write('Press Ctrl+C to stop.\n')

  let lastSignature = await snapshotSignature(projectRoot)
  let stopped = false

  const stop = (): void => {
    stopped = true
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (!stopped) {
    await sleep(intervalMs)
    const nextSignature = await snapshotSignature(projectRoot)
    if (nextSignature === lastSignature) continue

    lastSignature = nextSignature
    await runSingleSync(projectRoot, options.quiet)
  }

  process.stdout.write('Watch stopped.\n')
}

async function runSingleSync(projectRoot: string, quiet: boolean): Promise<void> {
  const startedAt = new Date().toISOString()
  try {
    const result = await performSync({
      projectRoot,
      check: false,
      verbose: false
    })

    if (quiet && result.changed.length === 0 && result.warnings.length === 0) {
      return
    }

    process.stdout.write(`[${startedAt}] sync\n`)
    if (result.changed.length === 0) {
      process.stdout.write('No changes.\n')
    } else {
      process.stdout.write(`Updated ${result.changed.length} item(s):\n- ${result.changed.join('\n- ')}\n`)
    }

    if (result.warnings.length > 0) {
      process.stdout.write(`Warnings:\n- ${result.warnings.join('\n- ')}\n`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stdout.write(`[${startedAt}] sync failed: ${message}\n`)
  }
}

async function snapshotSignature(projectRoot: string): Promise<string> {
  const paths = getProjectPaths(projectRoot)
  const parts = await Promise.all([
    fingerprintPath(paths.agentsProject, 'project'),
    fingerprintPath(paths.agentsMd, 'agents_md'),
    fingerprintPath(paths.mcpSelection, 'selection'),
    fingerprintPath(paths.mcpLocal, 'local'),
    fingerprintTree(paths.agentsSkillsDir, 'skills')
  ])

  return parts.join('|')
}

async function fingerprintPath(filePath: string, label: string): Promise<string> {
  if (!(await pathExists(filePath))) {
    return `${label}:missing`
  }

  const info = await lstat(filePath)
  const kind = info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'dir' : 'file'
  return `${label}:${kind}:${info.size}:${Math.round(info.mtimeMs)}`
}

async function fingerprintTree(rootDir: string, label: string): Promise<string> {
  if (!(await pathExists(rootDir))) {
    return `${label}:missing`
  }

  const entries: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const children = await readdir(currentDir, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))

    for (const child of children) {
      const absolute = path.join(currentDir, child.name)
      const relative = path.relative(rootDir, absolute)
      if (child.isDirectory()) {
        entries.push(`d:${relative}`)
        await walk(absolute)
        continue
      }
      const info = await lstat(absolute)
      const kind = info.isSymbolicLink() ? 'l' : 'f'
      entries.push(`${kind}:${relative}:${info.size}:${Math.round(info.mtimeMs)}`)
    }
  }

  await walk(rootDir)
  return `${label}:${entries.join(',')}`
}

function normalizeInterval(input: number): number {
  if (!Number.isFinite(input)) return 1200
  if (input < 200) return 200
  if (input > 60_000) return 60_000
  return Math.floor(input)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
