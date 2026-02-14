import path from 'node:path'
import * as clack from '@clack/prompts'
import color from 'picocolors'
import { pathExists } from '../core/fs.js'
import { ensureProjectGitignore } from '../core/gitignore.js'
import { initializeProjectSkeleton } from '../core/project.js'
import { performSync } from '../core/sync.js'
import { commandExists } from '../core/shell.js'
import type { IntegrationName, SyncMode } from '../types.js'
import { INTEGRATIONS } from '../integrations/registry.js'
import { getProjectPaths } from '../core/paths.js'
import { runReset } from './reset.js'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../core/trust.js'
import { formatWarnings, normalizeWarnings } from '../core/warnings.js'

export interface StartOptions {
  projectRoot: string
  nonInteractive: boolean
  yes: boolean
}

export async function runStart(options: StartOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  if (!(await pathExists(projectRoot))) {
    throw new Error(`Project path does not exist: ${projectRoot}`)
  }

  const interactive = !options.nonInteractive && !options.yes

  if (interactive) {
    clack.intro(color.cyan('agents start'))
    clack.note('One command setup for AGENTS.md + LLM integrations + MCP + SKILLS.', 'Welcome')
  }

  const preflight = collectPreflight()
  const missingPreflight = preflight.filter((item) => !item.ok)
  if (interactive && missingPreflight.length > 0) {
    clack.note(renderPreflight(missingPreflight), 'Preflight warnings')
  }

  if (interactive && (await shouldOfferCleanup(projectRoot))) {
    const doCleanup = await confirmOrCancel({
      message: 'Found local generated files. Cleanup before setup?',
      initialValue: true
    })
    if (doCleanup) {
      await runReset({ projectRoot, localOnly: false, hard: false })
    }
  }

  const defaults = getDefaults()
  const selectedIntegrations = interactive
    ? await selectIntegrations(defaults.integrationDefaults)
    : defaults.integrationDefaults

  const access = await resolveIntegrationAccess({
    projectRoot,
    selectedIntegrations,
    interactive,
    autoApprove: options.yes || options.nonInteractive
  })

  const hideGeneratedInVscode = interactive
    ? await selectVscodeHideDefaults(defaults.hideGeneratedInVscode)
    : defaults.hideGeneratedInVscode

  const syncMode = interactive
    ? await selectSyncMode(defaults.syncMode)
    : defaults.syncMode

  if (interactive) {
    const proceed = await confirmOrCancel({
      message: 'Apply this setup now?',
      initialValue: true
    })
    if (!proceed) {
      clack.outro('Setup canceled.')
      return
    }
  }

  const spin = interactive ? clack.spinner() : null
  spin?.start('Applying project setup...')

  const init = await initializeProjectSkeleton({
    projectRoot,
    force: true,
    integrations: selectedIntegrations,
    integrationOptions: access.integrationOptions,
    syncMode,
    hideGeneratedInVscode
  })

  await ensureProjectGitignore(projectRoot, syncMode)

  const sync = await performSync({
    projectRoot,
    check: false,
    verbose: false
  })

  spin?.stop('Setup complete.')

  const summaryLines = [
    `Project: ${projectRoot}`,
    `Integrations: ${selectedIntegrations.join(', ') || '(none)'}`,
    `Sync mode: ${syncMode}`,
    `VS Code hide tool dirs: ${hideGeneratedInVscode ? 'enabled' : 'disabled'}`,
    `Codex trust: ${access.summaries.codex}`,
    `Cursor approval: ${access.summaries.cursor}`,
    `Antigravity sync: ${access.summaries.antigravity}`,
    `Created/updated: ${init.changed.length}`
  ]

  const normalizedWarnings = normalizeWarnings([...init.warnings, ...sync.warnings])
  if (normalizedWarnings.length > 0) {
    summaryLines.push(`Warnings: ${normalizedWarnings.length}`)
  }

  if (interactive) {
    clack.note(summaryLines.join('\n'), 'Summary')
    const warningBlock = formatWarnings(normalizedWarnings, 4)
    if (warningBlock) {
      clack.note(warningBlock.replace(/^Warnings:\n/, '').trim(), 'Warnings')
    }
    clack.outro(
      [
        color.green('Next steps:'),
        '1) agents status',
        '2) agents doctor',
        '3) agents sync --check'
      ].join('\n'),
    )
    return
  }

  process.stdout.write(`Setup complete for ${projectRoot}\n`)
  process.stdout.write(`${summaryLines.join('\n')}\n`)
  const warningBlock = formatWarnings(normalizedWarnings, 4)
  if (warningBlock) {
    process.stdout.write(warningBlock)
  }
}

async function resolveIntegrationAccess(args: {
  projectRoot: string
  selectedIntegrations: IntegrationName[]
  interactive: boolean
  autoApprove: boolean
}): Promise<{
  integrationOptions: { cursorAutoApprove: boolean; antigravityGlobalSync: boolean }
  summaries: { codex: string; cursor: string; antigravity: string }
}> {
  const { projectRoot, selectedIntegrations, interactive, autoApprove } = args

  const summaries: { codex: string; cursor: string; antigravity: string } = {
    codex: 'not required',
    cursor: 'not required',
    antigravity: 'not required'
  }

  const integrationOptions = {
    cursorAutoApprove: true,
    antigravityGlobalSync: false
  }

  if (selectedIntegrations.includes('codex')) {
    const state = await getCodexTrustState(projectRoot)
    if (state === 'trusted') {
      summaries.codex = 'already trusted'
    } else {
      let approve = autoApprove
      if (interactive) {
        clack.note(
          [
            'Codex reads project .codex/config.toml only for trusted projects.',
            'Without trust, MCP from this project may not appear in codex mcp list.'
          ].join('\n'),
          'Codex trust required',
        )
        approve = await confirmOrCancel({
          message: 'Trust this project in Codex now?',
          initialValue: true
        })
      }

      if (!approve) {
        summaries.codex = 'skipped (project may stay untrusted)'
      } else {
        const result = await ensureCodexProjectTrusted(projectRoot)
        summaries.codex = result.changed ? `trusted (updated ${result.path})` : 'already trusted'
      }
    }
  }

  if (selectedIntegrations.includes('cursor')) {
    let approve = autoApprove
    if (interactive) {
      clack.note(
        [
          'Cursor MCP servers require approval before they are loaded.',
          'agents can auto-approve project-selected MCP servers via cursor-agent.'
        ].join('\n'),
        'Cursor MCP approval',
      )
      approve = await confirmOrCancel({
        message: 'Auto-approve selected MCP servers in Cursor?',
        initialValue: true
      })
    }
    integrationOptions.cursorAutoApprove = approve
    summaries.cursor = approve ? 'enabled' : 'disabled'
  }

  if (selectedIntegrations.includes('antigravity')) {
    integrationOptions.antigravityGlobalSync = false
    summaries.antigravity = 'project-local'
  }

  return {
    integrationOptions,
    summaries
  }
}

function collectPreflight(): Array<{ label: string; ok: boolean; detail: string }> {
  return INTEGRATIONS.map((integration) => {
    if (!integration.requiredBinary) {
      return { label: integration.label, ok: true, detail: 'no binary required' }
    }
    const ok = commandExists(integration.requiredBinary)
    return {
      label: integration.label,
      ok,
      detail: ok ? `${integration.requiredBinary} found` : `${integration.requiredBinary} missing`
    }
  })
}

function renderPreflight(items: Array<{ label: string; ok: boolean; detail: string }>): string {
  return items
    .map((item) => `${item.ok ? color.green('OK') : color.yellow('WARN')}  ${item.label}: ${item.detail}`)
    .join('\n')
}

async function shouldOfferCleanup(projectRoot: string): Promise<boolean> {
  const paths = getProjectPaths(projectRoot)
  const legacyAgentDir = path.join(projectRoot, '.agent')
  const candidates = [
    paths.generatedDir,
    paths.codexDir,
    paths.geminiDir,
    paths.cursorDir,
    paths.antigravityDir,
    legacyAgentDir,
    paths.vscodeMcp,
    paths.claudeSkillsBridge,
    paths.cursorSkillsBridge,
    paths.geminiSkillsBridge
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true
  }
  return false
}

function getDefaults(): {
  integrationDefaults: IntegrationName[]
  syncMode: SyncMode
  hideGeneratedInVscode: boolean
} {
  const available = INTEGRATIONS.filter((integration) => {
    if (!integration.requiredBinary) return true
    return commandExists(integration.requiredBinary)
  }).map((integration) => integration.id)

  const integrationDefaults: IntegrationName[] = available.includes('codex')
    ? ['codex']
    : available.length > 0
      ? [available[0]]
      : ['codex']

  return {
    integrationDefaults,
    syncMode: 'source-only',
    hideGeneratedInVscode: true
  }
}

async function selectIntegrations(defaults: IntegrationName[]): Promise<IntegrationName[]> {
  const value = await clack.multiselect({
    message: 'Choose LLM integrations',
    required: false,
    options: INTEGRATIONS.map((integration) => ({
      value: integration.id,
      label: integration.label,
      hint: integration.requiredBinary ? integration.requiredBinary : 'built-in'
    })),
    initialValues: defaults
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return (value as IntegrationName[]) ?? []
}

async function selectVscodeHideDefaults(defaultValue: boolean): Promise<boolean> {
  const value = await clack.confirm({
    message: 'Hide tool directories in VS Code explorer/search by default?',
    initialValue: defaultValue
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return Boolean(value)
}

async function selectSyncMode(defaultSyncMode: SyncMode): Promise<SyncMode> {
  const value = await clack.select({
    message: 'Choose sync mode',
    initialValue: defaultSyncMode,
    options: [
      {
        value: 'source-only',
        label: 'Source-only (recommended)',
        hint: 'Keep only .agents source files in git, generate client configs locally'
      },
      {
        value: 'commit-generated',
        label: 'Commit generated client configs',
        hint: 'Track .codex/.gemini/.vscode outputs in git'
      }
    ]
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return value as SyncMode
}

async function confirmOrCancel(args: { message: string; initialValue: boolean }): Promise<boolean> {
  const value = await clack.confirm(args)
  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }
  return Boolean(value)
}
