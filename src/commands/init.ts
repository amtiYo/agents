import path from 'node:path'
import { ensureProjectGitignore } from '../core/gitignore.js'
import { initializeProjectSkeleton } from '../core/project.js'
import * as ui from '../core/ui.js'

export interface InitOptions {
  projectRoot: string
  force: boolean
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)

  const spin = ui.spinner()
  spin.start('Initializing project scaffold...')

  const init = await initializeProjectSkeleton({
    projectRoot,
    force: options.force,
    integrations: [],
    integrationOptions: {
      cursorAutoApprove: true,
      antigravityGlobalSync: true
    },
    syncMode: 'source-only',
    hideGeneratedInVscode: true
  })

  await ensureProjectGitignore(projectRoot, 'source-only')

  spin.stop('Project initialized')

  ui.success(`Initialized v3 project scaffold in ${projectRoot}`)

  if (init.changed.length > 0) {
    ui.blank()
    ui.writeln('Created/updated:')
    ui.arrowList(init.changed)
  }

  if (init.warnings.length > 0) {
    ui.blank()
    for (const warning of init.warnings) {
      ui.warning(warning)
    }
  }

  ui.blank()
  ui.nextSteps('run "agents start" for guided setup.')
}
