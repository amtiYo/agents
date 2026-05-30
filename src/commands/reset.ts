import path from 'node:path'
import { cleanupManagedGitignore } from '../core/gitignore.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists, removeIfExists } from '../core/fs.js'
import { cleanupManagedClaudeInstructions } from '../core/claudeInstructions.js'
import { cleanupManagedClaudeDesktopConfig } from '../core/claudeDesktop.js'
import { cleanupVscodeSettingsIfManaged } from '../core/vscodeSettings.js'
import * as ui from '../core/ui.js'

export interface ResetOptions {
  projectRoot: string
  localOnly: boolean
  hard: boolean
}

/**
 * Performs a project reset by removing managed agent-related files and configuration according to the specified mode.
 *
 * In `hard` mode, removes all managed agent artifacts, Workspace/VS Code managed settings and managed `.gitignore` entries.
 * In `local-only` mode, removes workspace-local managed artifacts but keeps broader project-managed sources.
 * In the default (safe) mode, removes generated and workspace-managed artifacts while preserving source `.agents` files, root `AGENTS.md`, and managed `.gitignore` entries.
 *
 * @param options - Reset options:
 *   - `projectRoot`: root directory of the project to operate on
 *   - `localOnly`: when true, limit cleanup to workspace-local targets
 *   - `hard`: when true, perform the more destructive cleanup that removes additional config/state and managed `.gitignore` entries
 */
export async function runReset(options: ResetOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const paths = getProjectPaths(projectRoot)
  const legacyAgentDir = path.join(projectRoot, '.agent')

  const spin = ui.spinner()
  spin.start('Cleaning up...')

  const removed: string[] = []
  const warnings: string[] = []
  const claudeDesktopCleanup = await cleanupManagedClaudeDesktopConfig(projectRoot)
  if (claudeDesktopCleanup.changed && claudeDesktopCleanup.path) {
    removed.push(claudeDesktopCleanup.path)
  }
  if (claudeDesktopCleanup.warning) {
    warnings.push(claudeDesktopCleanup.warning)
  }

  if (options.hard) {
    const vscodeSettingsRemoved = await cleanupVscodeSettingsIfManaged({
      settingsPath: paths.vscodeSettings,
      statePath: paths.generatedVscodeSettingsState
    })
    if (vscodeSettingsRemoved) {
      removed.push(path.relative(projectRoot, paths.vscodeSettings) || paths.vscodeSettings)
    }
  }

  await cleanupManagedClaudeInstructions({
    projectRoot,
    check: false,
    changed: removed,
  })

  const targets = options.hard
    ? [
        paths.agentsDir,
        paths.rootAgentsMd,
        paths.codexDir,
        paths.geminiDir,
        paths.cursorDir,
        paths.antigravityDir,
        paths.windsurfDir,
        paths.opencodeDir,
        paths.opencodeConfig,
        legacyAgentDir,
        paths.vscodeMcp,
        paths.copilotCliMcp,
        paths.claudeDir,
        paths.junieDir
      ]
    : options.localOnly
      ? [
          paths.codexDir,
          paths.geminiDir,
          paths.cursorDir,
          paths.antigravityWorkspaceMcp,
          paths.antigravityDir,
          paths.windsurfDir,
          paths.opencodeDir,
          paths.opencodeConfig,
          legacyAgentDir,
          paths.vscodeMcp,
          paths.copilotCliMcp,
          paths.claudeSkillsBridge,
          paths.cursorSkillsBridge,
          paths.junieMcpDir,
          paths.junieSkillsBridge
        ]
      : [
          paths.generatedDir,
          paths.codexDir,
          paths.geminiDir,
          paths.cursorDir,
          paths.antigravityWorkspaceMcp,
          paths.antigravityDir,
          paths.windsurfDir,
          paths.opencodeDir,
          paths.opencodeConfig,
          legacyAgentDir,
          paths.vscodeMcp,
          paths.copilotCliMcp,
          paths.claudeSkillsBridge,
          paths.cursorSkillsBridge,
          paths.junieMcpDir,
          paths.junieSkillsBridge
        ]

  for (const target of targets) {
    if (!(await pathExists(target))) continue
    await removeIfExists(target)
    removed.push(path.relative(projectRoot, target) || target)
  }

  if (options.hard) {
    const gitignoreChanged = await cleanupManagedGitignore(projectRoot)
    if (gitignoreChanged) {
      removed.push('.gitignore (managed agents entries)')
    }
  }

  spin.stop('Cleanup complete')

  for (const warning of warnings) {
    ui.warning(warning)
  }

  if (removed.length === 0) {
    ui.info('Reset: nothing to clean')
    return
  }

  const mode = options.hard ? 'hard' : options.localOnly ? 'local-only' : 'safe'
  ui.success(`Reset (${mode}) cleaned ${removed.length} path(s):`)
  ui.arrowList(removed)

  if (!options.hard && !options.localOnly) {
    ui.blank()
    ui.hint('Safe reset keeps .agents source files, root AGENTS.md, and managed .gitignore entries. Use --hard to remove all agents-managed setup.')
  }
}
