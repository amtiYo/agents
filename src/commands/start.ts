import path from 'node:path'
import * as clack from '@clack/prompts'
import color from 'picocolors'
import { ensureGlobalCatalog } from '../core/catalog.js'
import { pathExists } from '../core/fs.js'
import { ensureProjectGitignore } from '../core/gitignore.js'
import { initializeProjectSkeleton } from '../core/project.js'
import { performSync } from '../core/sync.js'
import { commandExists } from '../core/shell.js'
import type { CatalogFile, IntegrationName, SyncMode } from '../types.js'
import { INTEGRATIONS } from '../integrations/registry.js'
import { getProjectPaths } from '../core/paths.js'
import { runReset } from './reset.js'
import { ensureCodexProjectTrusted, getCodexTrustState } from '../core/trust.js'

export interface StartOptions {
  projectRoot: string
  nonInteractive: boolean
  profile?: string
  yes: boolean
}

export async function runStart(options: StartOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  if (!(await pathExists(projectRoot))) {
    throw new Error(`Project path does not exist: ${projectRoot}`)
  }

  const { catalog, path: catalogPath, created } = await ensureGlobalCatalog()
  const interactive = !options.nonInteractive && !options.yes

  if (interactive) {
    clack.intro(color.cyan('agents start'))
    clack.note(
      [
        'One command setup for AGENTS.md + LLM integrations + MCP + SKILLS.',
        `Global catalog: ${catalogPath}`,
        created ? 'Catalog file was created automatically.' : 'Using existing global catalog file.'
      ].join('\n'),
      'Welcome',
    )
  }

  const preflight = collectPreflight()

  if (interactive) {
    clack.note(renderPreflight(preflight), 'Preflight')
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

  const defaults = getDefaults(catalog, options.profile)

  const selectedIntegrations = interactive
    ? await selectIntegrations(defaults.integrationDefaults)
    : defaults.integrationDefaults

  const access = await resolveIntegrationAccess({
    projectRoot,
    selectedIntegrations,
    interactive,
    autoApprove: options.yes || options.nonInteractive
  })

  const preset = interactive ? await selectPreset(catalog, defaults.presetId) : defaults.presetId
  const presetServers = getPresetServerIds(catalog, preset)

  const additionalServerIds = interactive
    ? await selectAdditionalMcp(catalog, presetServers)
    : []
  const selectedMcpServers = [...new Set([...presetServers, ...additionalServerIds])]

  const selectedSkillPacks = interactive
    ? await selectSkillPacks(catalog, defaults.skillPackDefaults)
    : defaults.skillPackDefaults
  const selectedSkills = interactive ? await selectSkills(catalog, selectedSkillPacks) : []

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
    selectedSkillPacks,
    selectedSkills,
    preset,
    selectedMcpServers
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
    `MCP preset: ${preset}`,
    `MCP servers: ${selectedMcpServers.join(', ') || '(none)'}`,
    `Skill packs: ${selectedSkillPacks.join(', ') || '(none)'}`,
    `Extra skills: ${selectedSkills.join(', ') || '(none)'}`,
    `Sync mode: ${syncMode}`,
    `Link mode: ${init.linkMode}`,
    `Codex trust: ${access.summaries.codex}`,
    `Cursor approval: ${access.summaries.cursor}`,
    `Antigravity sync: ${access.summaries.antigravity}`
  ]

  if (init.linkWarning) {
    summaryLines.push(`Link warning: ${init.linkWarning}`)
  }
  if (sync.warnings.length > 0) {
    summaryLines.push(`Warnings: ${sync.warnings.length}`)
  }

  if (interactive) {
    clack.note(summaryLines.join('\n'), 'Summary')
    if (sync.warnings.length > 0) {
      clack.note(sync.warnings.map((warning) => `- ${warning}`).join('\n'), 'Warnings')
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
  if (sync.warnings.length > 0) {
    process.stdout.write(`Warnings:\n- ${sync.warnings.join('\n- ')}\n`)
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
    antigravityGlobalSync: true
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
    let approve = autoApprove
    if (interactive) {
      clack.note(
        [
          'Antigravity MCP servers are stored in a user-level profile file.',
          'agents can keep a managed project-scoped subset in that global file.'
        ].join('\n'),
        'Antigravity global MCP sync',
      )
      approve = await confirmOrCancel({
        message: 'Allow global Antigravity MCP sync for this project?',
        initialValue: true
      })
    }
    integrationOptions.antigravityGlobalSync = approve
    summaries.antigravity = approve ? 'enabled' : 'disabled'
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
    paths.cursorSkillsBridge
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return true
  }
  return false
}

function getDefaults(catalog: CatalogFile, profile?: string): {
  integrationDefaults: IntegrationName[]
  presetId: string
  syncMode: SyncMode
  skillPackDefaults: string[]
} {
  const available = INTEGRATIONS.filter((integration) => {
    if (!integration.requiredBinary) return true
    return commandExists(integration.requiredBinary)
  }).map((integration) => integration.id)

  // Keep onboarding compact by default: preselect only one integration.
  const integrationDefaults: IntegrationName[] = available.includes('codex')
    ? ['codex']
    : available.length > 0
      ? [available[0]]
      : ['codex']

  const presetExists = profile ? catalog.mcpPresets.some((presetDef) => presetDef.id === profile) : false
  const presetId = presetExists ? (profile as string) : 'safe-core'

  return {
    integrationDefaults,
    presetId,
    syncMode: 'source-only',
    skillPackDefaults: catalog.skillPacks.some((pack) => pack.id === 'skills-starter') ? ['skills-starter'] : []
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

async function selectPreset(catalog: CatalogFile, defaultPreset: string): Promise<string> {
  const value = await clack.select({
    message: 'Choose MCP preset',
    initialValue: defaultPreset,
    options: catalog.mcpPresets.map((preset) => ({
      value: preset.id,
      label: preset.label,
      hint: preset.description
    }))
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return value as string
}

function getPresetServerIds(catalog: CatalogFile, presetId: string): string[] {
  const preset = catalog.mcpPresets.find((item) => item.id === presetId)
  if (!preset) return []
  return [...preset.serverIds]
}

async function selectAdditionalMcp(catalog: CatalogFile, presetServers: string[]): Promise<string[]> {
  const presetSet = new Set(presetServers)
  const extraCandidates = Object.entries(catalog.mcpServers)
    .filter(([id]) => !presetSet.has(id))
    .map(([id, server]) => ({ value: id, label: server.label, hint: server.description }))

  if (extraCandidates.length === 0) return []

  const value = await clack.multiselect({
    message: 'Optional: add more MCP servers',
    required: false,
    options: extraCandidates
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return (value as string[]) ?? []
}

async function selectSkillPacks(catalog: CatalogFile, defaults: string[]): Promise<string[]> {
  if (catalog.skillPacks.length === 0) return []

  const value = await clack.multiselect({
    message: 'Optional: choose skill packs',
    required: false,
    initialValues: defaults,
    options: catalog.skillPacks.map((pack) => ({
      value: pack.id,
      label: pack.label,
      hint: pack.description
    }))
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return (value as string[]) ?? []
}

async function selectSkills(catalog: CatalogFile, selectedPacks: string[]): Promise<string[]> {
  const fromPacks = new Set<string>()
  for (const packId of selectedPacks) {
    const pack = catalog.skillPacks.find((entry) => entry.id === packId)
    if (!pack) continue
    for (const skillId of pack.skillIds) {
      fromPacks.add(skillId)
    }
  }

  const options = Object.entries(catalog.skills)
    .filter(([id]) => !fromPacks.has(id))
    .map(([id, skill]) => ({ value: id, label: skill.name, hint: skill.description }))

  if (options.length === 0) return []

  const value = await clack.multiselect({
    message: 'Optional: add extra standalone skills',
    required: false,
    options
  })

  if (clack.isCancel(value)) {
    clack.cancel('Setup canceled.')
    process.exit(1)
  }

  return (value as string[]) ?? []
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
