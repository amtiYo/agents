import path from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { performSync } from '../core/sync.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists } from '../core/fs.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'

export interface WatchOptions {
  projectRoot: string
  intervalMs: number
  once: boolean
  quiet: boolean
}

export async function runWatch(options: WatchOptions): Promise<void> {
  ui.setContext({ quiet: options.quiet })

  const projectRoot = path.resolve(options.projectRoot)
  const intervalMs = normalizeInterval(options.intervalMs)

  if (options.once) {
    await runSingleSync(projectRoot, options.quiet)
    return
  }

  ui.info(`Watching .agents files in ${projectRoot}`)
  ui.dim(`Interval: ${intervalMs}ms. Press Ctrl+C to stop.`)
  ui.blank()

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

  ui.blank()
  ui.info('Watch stopped')
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

    ui.dim(`[${startedAt}] sync`)

    if (result.changed.length === 0) {
      ui.writeln('  No changes.')
    } else {
      ui.success(`Updated ${result.changed.length} item(s):`)
      ui.arrowList(result.changed, 4)
    }

    const warningBlock = formatWarnings(result.warnings, 5)
    if (warningBlock) {
      for (const line of warningBlock.split('\n').filter(Boolean)) {
        if (line.startsWith('- ')) {
          ui.warning(line.slice(2))
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ui.error(`[${startedAt}] sync failed: ${message}`)
  }
}

async function snapshotSignature(projectRoot: string): Promise<string> {
  const paths = getProjectPaths(projectRoot)
  const parts = await Promise.all([
    fingerprintPath(paths.agentsConfig, 'agents_config'),
    fingerprintPath(paths.rootAgentsMd, 'agents_md'),
    fingerprintPath(paths.agentsLocal, 'local'),
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
