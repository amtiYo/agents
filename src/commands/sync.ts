import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'

export interface SyncCommandOptions {
  projectRoot: string
  check: boolean
  verbose: boolean
}

export async function runSync(options: SyncCommandOptions): Promise<void> {
  const result = await performSync({
    projectRoot: options.projectRoot,
    check: options.check,
    verbose: options.verbose
  })

  const warningBlock = formatWarnings(result.warnings, 5)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }

  if (result.changed.length === 0) {
    process.stdout.write(options.check ? 'OK: no changes needed.\n' : 'No changes.\n')
    return
  }

  process.stdout.write(
    `${options.check ? 'Would update' : 'Updated'} ${result.changed.length} item(s):\n- ${result.changed.join('\n- ')}\n`,
  )

  if (options.check) {
    process.exitCode = 2
  }
}
