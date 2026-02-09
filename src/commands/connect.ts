import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface ConnectOptions {
  projectRoot: string
  llm?: string
  interactive: boolean
  verbose: boolean
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)

  const rawSelection = options.llm

  let selected: IntegrationName[] = []
  if (rawSelection) {
    selected = parseIntegrationList(rawSelection)
  } else if (options.interactive) {
    selected = await promptSelection(config.integrations.enabled)
  } else {
    throw new Error('No LLM selected. Use --llm or --interactive.')
  }

  const spin = ui.spinner()
  spin.start('Updating integrations...')

  config.integrations.enabled = selected
  await saveAgentsConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  spin.stop('Integrations updated')

  ui.keyValue('Integrations', ui.formatList(selected))

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

async function promptSelection(current: IntegrationName[]): Promise<IntegrationName[]> {
  const value = await ui.clack.multiselect({
    message: 'Select LLM integrations',
    options: INTEGRATIONS.map((integration) => ({
      value: integration.id,
      label: integration.label,
      hint: integration.requiredBinary ?? 'built-in'
    })),
    initialValues: current,
    required: false
  })

  if (ui.clack.isCancel(value)) {
    ui.clack.cancel('Operation canceled.')
    process.exit(1)
  }

  return (value as IntegrationName[]) ?? []
}
