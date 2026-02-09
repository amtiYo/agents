import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'

export interface SyncCommandOptions {
  projectRoot: string
  check: boolean
  verbose: boolean
}

export async function runSync(options: SyncCommandOptions): Promise<void> {
  const spin = ui.spinner()
  spin.start(options.check ? 'Checking for changes...' : 'Syncing configurations...')

  const result = await performSync({
    projectRoot: options.projectRoot,
    check: options.check,
    verbose: options.verbose
  })

  spin.stop(options.check ? 'Check complete' : 'Sync complete')

  const warningBlock = formatWarnings(result.warnings, 5)
  if (warningBlock) {
    ui.blank()
    for (const line of warningBlock.split('\n').filter(Boolean)) {
      if (line.startsWith('- ')) {
        ui.warning(line.slice(2))
      } else if (line.startsWith('Warnings:')) {
        // skip header, we'll show individual warnings
      } else {
        ui.dim(line)
      }
    }
  }

  if (result.changed.length === 0) {
    ui.success(options.check ? 'No changes needed' : 'No changes')
    return
  }

  ui.blank()
  if (options.check) {
    ui.info(`Would update ${result.changed.length} item(s):`)
  } else {
    ui.success(`Updated ${result.changed.length} item(s):`)
  }
  ui.arrowList(result.changed)

  if (options.check) {
    process.exitCode = 2
  }
}
