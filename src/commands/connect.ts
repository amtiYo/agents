import prompts from 'prompts'
import { loadProjectConfig, saveProjectConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface ConnectOptions {
  projectRoot: string
  llm?: string
  interactive: boolean
  verbose: boolean
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const config = await loadProjectConfig(options.projectRoot)

  const rawSelection = options.llm

  let selected: IntegrationName[] = []
  if (rawSelection) {
    selected = parseIntegrationList(rawSelection)
  } else if (options.interactive) {
    selected = await promptSelection(config.enabledIntegrations)
  } else {
    throw new Error('No LLM selected. Use --llm or --interactive.')
  }

  config.enabledIntegrations = selected
  await saveProjectConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  process.stdout.write(`Enabled integrations: ${selected.join(', ') || '(none)'}\n`)
  if (syncResult.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${syncResult.warnings.join('\n- ')}\n`)
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
