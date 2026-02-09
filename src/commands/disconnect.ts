import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface DisconnectOptions {
  projectRoot: string
  llm?: string
  interactive: boolean
  verbose: boolean
}

export async function runDisconnect(options: DisconnectOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)
  const enabled = new Set(config.integrations.enabled)

  const rawSelection = options.llm

  const toDisable = rawSelection
    ? parseIntegrationList(rawSelection)
    : options.interactive
      ? await promptSelection(config.integrations.enabled)
      : []

  const spin = ui.spinner()
  spin.start('Updating integrations...')

  for (const integration of toDisable) {
    enabled.delete(integration)
  }

  config.integrations.enabled = [...enabled]
  await saveAgentsConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  spin.stop('Integrations updated')

  ui.keyValue('Integrations', ui.formatList(config.integrations.enabled))

  const warningBlock = formatWarnings(syncResult.warnings, 5)
  if (warningBlock) {
    ui.blank()
    for (const line of warningBlock.split('\n').filter(Boolean)) {
      if (line.startsWith('- ')) {
        ui.warning(line.slice(2))
      }
    }
  }

  ui.success(`Updated ${syncResult.changed.length} item(s)`)
}

async function promptSelection(enabled: IntegrationName[]): Promise<IntegrationName[]> {
  if (enabled.length === 0) return []

  const value = await ui.clack.multiselect({
    message: 'Select LLM integrations to disable',
    options: INTEGRATIONS.filter((integration) => enabled.includes(integration.id)).map((integration) => ({
      value: integration.id,
      label: integration.label
    })),
    required: false
  })

  if (ui.clack.isCancel(value)) {
    ui.clack.cancel('Operation canceled.')
    process.exit(1)
  }

  return (value as IntegrationName[]) ?? []
}
