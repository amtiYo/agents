import { loadAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { performSync } from '../core/sync.js'
import { CancelledError } from '../core/errors.js'
import { formatWarnings } from '../core/warnings.js'
import * as ui from '../core/ui.js'
import type { IntegrationName } from '../types.js'
import { INTEGRATIONS, parseIntegrationList } from '../integrations/registry.js'

export interface ConnectOptions {
  projectRoot: string
  llm?: string
  interactive: boolean
  verbose: boolean
  promptSelection?: (current: IntegrationName[]) => Promise<IntegrationName[]>
}

export async function runConnect(options: ConnectOptions): Promise<void> {
  const config = await loadAgentsConfig(options.projectRoot)
  const currentlyEnabled = new Set(config.integrations.enabled)

  const rawSelection = options.llm

  let selected: IntegrationName[] = []
  if (rawSelection) {
    selected = parseIntegrationList(rawSelection)
  } else if (options.interactive) {
    selected = await (options.promptSelection ?? promptSelection)(config.integrations.enabled)
  } else {
    throw new Error('No LLM selected. Use --llm or --interactive.')
  }

  const added = selected.filter((integration) => !currentlyEnabled.has(integration))
  if (selected.length === 0) {
    ui.info('No integrations selected.')
    ui.keyValue('Integrations', ui.formatList(config.integrations.enabled))
    return
  }

  for (const integration of added) {
    currentlyEnabled.add(integration)
  }
  const nextEnabled = [...currentlyEnabled]

  const spin = ui.spinner()
  spin.start(added.length > 0 ? 'Updating integrations...' : 'Synchronizing integrations...')

  let syncResult
  try {
    if (added.length > 0) {
      config.integrations.enabled = nextEnabled
      await saveAgentsConfig(options.projectRoot, config)
    }
    syncResult = await performSync({
      projectRoot: options.projectRoot,
      check: false,
      verbose: options.verbose
    })
  } catch (error) {
    spin.stop('Synchronization failed')
    throw error
  }

  spin.stop(added.length > 0 ? 'Integrations updated' : 'Integrations synchronized')

  if (added.length > 0) {
    ui.keyValue('Added', ui.formatList(added))
  } else {
    ui.info('No new integrations selected; existing integrations synchronized.')
  }
  ui.keyValue('Integrations', ui.formatList(nextEnabled))

  const warningBlock = formatWarnings(syncResult.warnings, 5)
  if (warningBlock) {
    ui.blank()
    for (const line of warningBlock.split('\n').filter(Boolean)) {
      if (line.startsWith('- ')) {
        ui.warning(line.slice(2))
      }
    }
  }

  ui.success(`${added.length > 0 ? 'Updated' : 'Synchronized'} ${syncResult.changed.length} item(s)`)
}

async function promptSelection(current: IntegrationName[]): Promise<IntegrationName[]> {
  const disabled = getConnectableIntegrations(current)
  if (disabled.length === 0) {
    return []
  }

  const value = await ui.clack.multiselect({
    message: 'Select LLM integrations to add',
    options: disabled,
    required: false
  })

  if (ui.clack.isCancel(value)) {
    ui.clack.cancel('Operation canceled.')
    throw new CancelledError()
  }

  return (value as IntegrationName[]) ?? []
}

export function getConnectableIntegrations(current: IntegrationName[]): Array<{ value: IntegrationName; label: string; hint?: string }> {
  return INTEGRATIONS
    .filter((integration) => !current.includes(integration.id))
    .map((integration) => ({
      value: integration.id,
      label: integration.label,
      hint: integration.requiredBinary ?? 'built-in'
    }))
}
