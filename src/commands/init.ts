import path from 'node:path'
import { ensureProjectGitignore } from '../core/gitignore.js'
import { initializeProjectSkeleton } from '../core/project.js'

export interface InitOptions {
  projectRoot: string
  force: boolean
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)

  const init = await initializeProjectSkeleton({
    projectRoot,
    force: options.force,
    integrations: [],
    integrationOptions: {
      cursorAutoApprove: true,
      antigravityGlobalSync: false
    },
    syncMode: 'source-only',
    hideGeneratedInVscode: true
  })

  await ensureProjectGitignore(projectRoot, 'source-only')

  process.stdout.write(`Initialized v3 project scaffold in ${projectRoot}\n`)
  if (init.changed.length > 0) {
    process.stdout.write(`Created/updated:\n- ${init.changed.join('\n- ')}\n`)
  }
  process.stdout.write('Next: run "agents start" for guided setup.\n')
}
