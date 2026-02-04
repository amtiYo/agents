import prompts from 'prompts'
import { loadConfig, saveConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface ConnectOptions {
  projectRoot: string
  ai?: string
  interactive: boolean
  verbose: boolean
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const config = await loadConfig(options.projectRoot)

  let selected: IntegrationName[] = []
  if (options.ai) {
    selected = parseIntegrationList(options.ai)
  } else if (options.interactive) {
    selected = await promptAiSelection(config.enabledIntegrations)
  } else {
    throw new Error('No AI selected. Use --ai or --interactive.')
  }

  config.enabledIntegrations = selected
  await saveConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  process.stdout.write(`Enabled integrations: ${selected.join(', ') || '(none)'}\n`)
  if (syncResult.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${syncResult.warnings.join('\n- ')}\n`)
  }
  if (syncResult.changed.length === 0) {
    process.stdout.write('No sync changes.\n')
  } else {
    process.stdout.write(`Updated ${syncResult.changed.length} items.\n`)
  }
}

async function promptAiSelection(current: IntegrationName[]): Promise<IntegrationName[]> {
  const response = await prompts({
    type: 'multiselect',
    name: 'value',
    message: 'Select AI integrations',
    choices: INTEGRATIONS.map((integration) => ({
      title: integration.label,
      value: integration.id,
      selected: current.includes(integration.id)
    })),
    initial: current.length > 0 ? undefined : 0,
    hint: '- Space to select. Enter to confirm.'
  })

  const values = response.value as IntegrationName[] | undefined
  return values ?? []
}
