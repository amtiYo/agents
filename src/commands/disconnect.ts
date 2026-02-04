import prompts from 'prompts'
import { loadProjectConfig, saveProjectConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface DisconnectOptions {
  projectRoot: string
  llm?: string
  interactive: boolean
  verbose: boolean
}

export async function runDisconnect(options: DisconnectOptions): Promise<void> {
  const config = await loadProjectConfig(options.projectRoot)
  const enabled = new Set(config.enabledIntegrations)

  const rawSelection = options.llm

  const toDisable = rawSelection
    ? parseIntegrationList(rawSelection)
    : options.interactive
      ? await promptSelection(config.enabledIntegrations)
      : []

  for (const integration of toDisable) {
    enabled.delete(integration)
  }

  config.enabledIntegrations = [...enabled]
  await saveProjectConfig(options.projectRoot, config)

  const syncResult = await performSync({
    projectRoot: options.projectRoot,
    check: false,
    verbose: options.verbose
  })

  process.stdout.write(`Enabled integrations: ${config.enabledIntegrations.join(', ') || '(none)'}\n`)
  if (syncResult.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${syncResult.warnings.join('\n- ')}\n`)
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
