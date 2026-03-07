import * as ui from '../core/ui.js'
import { checkForUpdates } from '../core/updateCheck.js'
import { CLI_VERSION } from '../core/version.js'

export interface UpdateOptions {
  projectRoot: string
  json: boolean
  check: boolean
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  ui.setContext({ json: options.json })

  const status = await checkForUpdates({
    currentVersion: CLI_VERSION,
    projectRoot: options.projectRoot,
    forceRefresh: true
  })
  const staleCacheWithoutNewerVersion = status.source === 'cache-stale' && !status.isOutdated

  if (options.json) {
    ui.json({
      currentVersion: status.currentVersion,
      latestVersion: status.latestVersion,
      isOutdated: status.isOutdated,
      upgradeCommand: status.upgradeCommand,
      checkedAt: status.checkedAt,
      source: status.source,
      error: status.error
    })
  } else if (status.latestVersion === null) {
    ui.warning(`Could not determine latest version (${status.error ?? 'unknown error'})`)
    ui.hint(`Manual update: ${status.upgradeCommand}`)
  } else if (staleCacheWithoutNewerVersion) {
    ui.warning(`Could not confirm latest version (${status.error ?? 'network error'})`)
    ui.hint(`Retry later or update manually: ${status.upgradeCommand}`)
  } else if (status.isOutdated) {
    ui.warning(`Update available: ${status.currentVersion} -> ${status.latestVersion}`)
    ui.hint(`Run "${status.upgradeCommand}"`)
  } else {
    ui.success(`Up to date (${status.currentVersion})`)
  }

  if (!options.check) return

  if (status.latestVersion === null) {
    process.exitCode = 1
    return
  }

  if (staleCacheWithoutNewerVersion) {
    process.exitCode = 1
    return
  }

  if (status.isOutdated) {
    process.exitCode = 10
  }
}
