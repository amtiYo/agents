import path from 'node:path'
import { cleanupManagedGitignore } from '../core/gitignore.js'
import { getProjectPaths } from '../core/paths.js'
import { pathExists, removeIfExists } from '../core/fs.js'
import { cleanupVscodeSettingsIfManaged } from '../core/vscodeSettings.js'
import * as ui from '../core/ui.js'

export interface ResetOptions {
  projectRoot: string
  localOnly: boolean
  hard: boolean
}

export async function runReset(options: ResetOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const paths = getProjectPaths(projectRoot)
  const legacyAgentDir = path.join(projectRoot, '.agent')

  const spin = ui.spinner()
  spin.start('Cleaning up...')

  const removed: string[] = []
  if (options.hard) {
    const vscodeSettingsRemoved = await cleanupVscodeSettingsIfManaged({
      settingsPath: paths.vscodeSettings,
      statePath: paths.generatedVscodeSettingsState
    })
    if (vscodeSettingsRemoved) {
      removed.push(path.relative(projectRoot, paths.vscodeSettings) || paths.vscodeSettings)
    }
  }

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
        paths.claudeDir
      ]
    : options.localOnly
      ? [
          paths.codexDir,
          paths.geminiDir,
          paths.cursorDir,
          paths.antigravityDir,
          paths.windsurfDir,
          paths.opencodeDir,
          paths.opencodeConfig,
          legacyAgentDir,
          paths.vscodeMcp,
          paths.claudeSkillsBridge,
          paths.cursorSkillsBridge
        ]
      : [
          paths.generatedDir,
          paths.codexDir,
          paths.geminiDir,
          paths.cursorDir,
          paths.antigravityDir,
          paths.windsurfDir,
          paths.opencodeDir,
          paths.opencodeConfig,
          legacyAgentDir,
          paths.vscodeMcp,
          paths.claudeSkillsBridge,
          paths.cursorSkillsBridge
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
