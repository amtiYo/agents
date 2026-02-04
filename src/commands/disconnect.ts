import prompts from 'prompts'
import { loadConfig, saveConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface DisconnectOptions {
  projectRoot: string
  ai?: string
  interactive: boolean
  verbose: boolean
}

export async function runDisconnect(options: DisconnectOptions): Promise<void> {
  const config = await loadConfig(options.projectRoot)
  const enabled = new Set(config.enabledIntegrations)

  let toDisable: IntegrationName[] = []
  if (options.ai) {
    toDisable = parseIntegrationList(options.ai)
  } else if (options.interactive) {
    toDisable = await promptDisableSelection(config.enabledIntegrations)
  }

  for (const integration of toDisable) {
    enabled.delete(integration)
  }

  config.enabledIntegrations = [...enabled]
  await saveConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  process.stdout.write(`Enabled integrations: ${config.enabledIntegrations.join(', ') || '(none)'}\n`)
  if (syncResult.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${syncResult.warnings.join('\n- ')}\n`)
  }
  if (syncResult.changed.length === 0) {
    process.stdout.write('No sync changes.\n')
  } else {
    process.stdout.write(`Updated ${syncResult.changed.length} items.\n`)
  }
}

async function promptDisableSelection(enabled: IntegrationName[]): Promise<IntegrationName[]> {
  if (enabled.length === 0) return []
  const response = await prompts({
    type: 'multiselect',
    name: 'value',
    message: 'Select integrations to disable',
    choices: INTEGRATIONS.filter((integration) => enabled.includes(integration.id)).map((integration) => ({
      title: integration.label,
      value: integration.id
    })),
    hint: '- Space to select. Enter to confirm.'
  })
  return (response.value as IntegrationName[] | undefined) ?? []
}
