import path from 'node:path'
import { lstat, readlink, readdir, rmdir } from 'node:fs/promises'
import { cleanupManagedGitignore } from '../core/gitignore.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists, readTextOrEmpty, removeIfExists, writeTextAtomic } from '../core/fs.js'
import {
  isLegacyGeneratedCodexConfig,
  removeCodexManagedBlock,
  removeLegacyGeneratedCodexMcp
} from '../core/codexConfig.js'
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

  await cleanupCodexConfig({
    projectRoot,
    configPath: paths.codexConfig,
    generatedPath: paths.generatedCodex,
    removed,
    warnings
  })

  const bridges = [
    { bridgePath: paths.claudeSkillsBridge, sourcePath: paths.agentsSkillsDir },
    { bridgePath: paths.cursorSkillsBridge, sourcePath: paths.agentsSkillsDir },
    { bridgePath: paths.geminiSkillsBridge, sourcePath: paths.agentsSkillsDir },
    { bridgePath: paths.windsurfSkillsBridge, sourcePath: paths.agentsSkillsDir },
    { bridgePath: paths.junieSkillsBridge, sourcePath: paths.agentsSkillsDir },
    { bridgePath: path.join(legacyAgentDir, 'skills'), sourcePath: paths.agentsSkillsDir }
  ]
  for (const bridge of bridges) {
    if (!(await isManagedSkillBridge(bridge.bridgePath, bridge.sourcePath))) continue
    await removeResetTarget(bridge.bridgePath, projectRoot, removed)
  }

  const targets = [
    paths.geminiSettings,
    paths.cursorMcp,
    paths.antigravityWorkspaceMcp,
    paths.antigravityProjectMcp,
    paths.opencodeConfig,
    paths.vscodeMcp,
    paths.copilotCliMcp,
    paths.junieMcp
  ]
  if (!options.localOnly) {
    targets.push(paths.generatedDir)
  }
  if (options.hard) {
    targets.push(paths.agentsDir, paths.rootAgentsMd)
  }

  for (const target of targets) {
    await removeResetTarget(target, projectRoot, removed)
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

async function cleanupCodexConfig(args: {
  projectRoot: string
  configPath: string
  generatedPath: string
  removed: string[]
  warnings: string[]
}): Promise<void> {
  if (!(await pathExists(args.configPath))) return

  try {
    const existing = await readTextOrEmpty(args.configPath)
    let cleaned = removeCodexManagedBlock(existing)
    if (cleaned === existing && isLegacyGeneratedCodexConfig(existing)) {
      const generated = await readTextOrEmpty(args.generatedPath)
      if (generated === existing) {
        cleaned = ''
      } else {
        cleaned = removeLegacyGeneratedCodexMcp(existing)
      }
    }

    if (cleaned === existing) return
    if (cleaned.trim().length === 0) {
      await removeResetTarget(args.configPath, args.projectRoot, args.removed)
      return
    }

    await writeTextAtomic(args.configPath, cleaned)
    args.removed.push(path.relative(args.projectRoot, args.configPath) || args.configPath)
  } catch (error) {
    args.warnings.push(
      `Failed to clean managed Codex MCP from ${args.configPath}; preserved the file. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function removeResetTarget(target: string, projectRoot: string, removed: string[]): Promise<void> {
  if (!(await pathExists(target))) return
  await removeIfExists(target)
  removed.push(path.relative(projectRoot, target) || target)
  await removeEmptyParents(path.dirname(target), projectRoot)
}

async function removeEmptyParents(startPath: string, projectRoot: string): Promise<void> {
  let current = startPath
  const rootPrefix = `${projectRoot}${path.sep}`
  while (current.startsWith(rootPrefix) && current !== projectRoot) {
    let entries: string[]
    try {
      entries = await readdir(current)
    } catch {
      return
    }
    if (entries.length > 0) return
    await rmdir(current)
    current = path.dirname(current)
  }
}

async function isManagedSkillBridge(bridgePath: string, sourcePath: string): Promise<boolean> {
  if (!(await pathExists(bridgePath))) return false

  let info
  try {
    info = await lstat(bridgePath)
  } catch {
    return false
  }

  if (info.isSymbolicLink()) {
    try {
      const current = await readlink(bridgePath)
      const expected = path.relative(path.dirname(bridgePath), sourcePath) || '.'
      return current === expected || path.resolve(path.dirname(bridgePath), current) === sourcePath
    } catch {
      return false
    }
  }

  return info.isDirectory() && await pathExists(path.join(bridgePath, '.agents_bridge'))
}
