import path from 'node:path'
import { ensureGlobalCatalog } from '../core/catalog.js'
import { ensureProjectGitignore } from '../core/gitignore.js'
import { initializeProjectSkeleton } from '../core/project.js'

export interface InitOptions {
  projectRoot: string
  force: boolean
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot)
  const { catalog } = await ensureGlobalCatalog()
  const safeCore = catalog.mcpPresets.find((preset) => preset.id === 'safe-core')

  const init = await initializeProjectSkeleton({
    projectRoot,
    force: options.force,
    integrations: [],
    syncMode: 'source-only',
    selectedSkillPacks: [],
    selectedSkills: [],
    preset: safeCore?.id ?? 'safe-core',
    selectedMcpServers: safeCore?.serverIds ?? []
  })

  await ensureProjectGitignore(projectRoot, 'source-only')

  process.stdout.write(`Initialized v2 project scaffold in ${projectRoot}\n`)
  if (init.changed.length > 0) {
    process.stdout.write(`Created/updated:\n- ${init.changed.join('\n- ')}\n`)
  }
  if (init.linkWarning) {
    process.stdout.write(`Warning: ${init.linkWarning}\n`)
  }
  process.stdout.write('Next: run "agents start" for guided setup.\n')
}
