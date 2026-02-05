import prompts from 'prompts'
import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import { formatWarnings } from '../core/warnings.js'
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

  process.stdout.write(`Enabled integrations: ${config.integrations.enabled.join(', ') || '(none)'}\n`)
  const warningBlock = formatWarnings(syncResult.warnings, 5)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
  process.stdout.write(`Updated ${syncResult.changed.length} item(s).\n`)
}

async function promptSelection(enabled: IntegrationName[]): Promise<IntegrationName[]> {
  if (enabled.length === 0) return []

  const response = await prompts({
    type: 'multiselect',
    name: 'value',
    message: 'Select LLM integrations to disable',
    choices: INTEGRATIONS.filter((integration) => enabled.includes(integration.id)).map((integration) => ({
      title: integration.label,
      value: integration.id
    })),
    hint: '- Space to select. Enter to confirm.'
  })

  return (response.value as IntegrationName[] | undefined) ?? []
}
