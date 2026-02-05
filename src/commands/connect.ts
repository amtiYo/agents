import prompts from 'prompts'
import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
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

  config.integrations.enabled = selected
  await saveAgentsConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  process.stdout.write(`Enabled integrations: ${selected.join(', ') || '(none)'}\n`)
  const warningBlock = formatWarnings(syncResult.warnings, 5)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
  process.stdout.write(`Updated ${syncResult.changed.length} item(s).\n`)
}

async function promptSelection(current: IntegrationName[]): Promise<IntegrationName[]> {
  const response = await prompts({
    type: 'multiselect',
    name: 'value',
    message: 'Select LLM integrations',
    choices: INTEGRATIONS.map((integration) => ({
      title: integration.label,
      value: integration.id,
      selected: current.includes(integration.id)
    })),
    initial: current.length > 0 ? undefined : 0,
    hint: '- Space to select. Enter to confirm.'
  })

  return (response.value as IntegrationName[] | undefined) ?? []
}
