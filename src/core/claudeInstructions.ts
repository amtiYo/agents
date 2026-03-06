import path from 'node:path'
import { pathExists, readJson, readTextOrEmpty, removeIfExists, writeJsonAtomic, writeTextAtomic } from './fs.js'
import { getProjectPaths } from './paths.js'

export interface ClaudeInstructionsState {
  managed: boolean
}

const MANAGED_CLAUDE_MD_LINE = '@AGENTS.md'

export function buildClaudeInstructionsWrapper(): string {
  return `${MANAGED_CLAUDE_MD_LINE}\n`
}

export function isClaudeInstructionsWrapper(content: string): boolean {
  return normalizeClaudeInstructions(content) === MANAGED_CLAUDE_MD_LINE
}

export async function syncClaudeInstructions(args: {
  enabled: boolean;
  projectRoot: string;
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const { enabled, projectRoot, check, changed, warnings } = args
  const paths = getProjectPaths(projectRoot)
  const state = await loadClaudeInstructionsState(
    paths.generatedClaudeInstructionsState,
  )
  const hasAgentsInstructions = await pathExists(paths.rootAgentsMd)
  const currentContent = await readTextOrEmpty(paths.rootClaudeMd)
  const hasClaudeInstructions = currentContent.length > 0
  const wrapperDetected = isClaudeInstructionsWrapper(currentContent)

  if (!enabled) {
    const removed = await cleanupManagedClaudeInstructions({
      projectRoot,
      check,
      changed,
    })
    if (!check && (removed || state.managed)) {
      await saveClaudeInstructionsState(paths.generatedClaudeInstructionsState, {
        managed: false,
      })
    }
    return
  }

  if (!hasAgentsInstructions) {
    warnings.push(
      'Claude integration is enabled but root AGENTS.md is missing; skipped CLAUDE.md wrapper sync.',
    )
    return
  }

  if (!hasClaudeInstructions || wrapperDetected) {
    await writeManagedFile(
      paths.rootClaudeMd,
      buildClaudeInstructionsWrapper(),
      projectRoot,
      check,
      changed,
    )
    if (!check) {
      await saveClaudeInstructionsState(paths.generatedClaudeInstructionsState, {
        managed: true,
      })
    }
    return
  }

  if (state.managed) {
    warnings.push(
      'CLAUDE.md no longer matches the agents-managed wrapper; preserving custom content and stopping management.',
    )
    if (check) {
      changed.push(toChangedEntry(projectRoot, paths.rootClaudeMd))
      return
    }

    await saveClaudeInstructionsState(paths.generatedClaudeInstructionsState, {
      managed: false,
    })
    return
  }

  warnings.push(
    'Found existing root CLAUDE.md with custom content; preserving it and skipping agents wrapper sync.',
  )
}

export async function cleanupManagedClaudeInstructions(args: {
  projectRoot: string;
  check: boolean;
  changed: string[];
}): Promise<boolean> {
  const { projectRoot, check, changed } = args
  const paths = getProjectPaths(projectRoot)
  const state = await loadClaudeInstructionsState(
    paths.generatedClaudeInstructionsState,
  )
  const currentContent = await readTextOrEmpty(paths.rootClaudeMd)
  if (!isClaudeInstructionsWrapper(currentContent)) {
    if (!check && state.managed) {
      await saveClaudeInstructionsState(paths.generatedClaudeInstructionsState, {
        managed: false,
      })
    }
    return false
  }

  changed.push(toChangedEntry(projectRoot, paths.rootClaudeMd))
  if (!check) {
    await removeIfExists(paths.rootClaudeMd)
    await saveClaudeInstructionsState(paths.generatedClaudeInstructionsState, {
      managed: false,
    })
  }
  return true
}

export async function getClaudeInstructionsHealth(projectRoot: string): Promise<{
  exists: boolean;
  hasAgents: boolean;
  isWrapper: boolean;
  managed: boolean;
}> {
  const paths = getProjectPaths(projectRoot)
  const [hasAgents, state, currentContent] = await Promise.all([
    pathExists(paths.rootAgentsMd),
    loadClaudeInstructionsState(paths.generatedClaudeInstructionsState),
    readTextOrEmpty(paths.rootClaudeMd),
  ])

  const exists = currentContent.length > 0
  const isWrapper = isClaudeInstructionsWrapper(currentContent)
  return {
    exists,
    hasAgents,
    isWrapper,
    managed: isWrapper || state.managed,
  }
}

async function loadClaudeInstructionsState(
  statePath: string,
): Promise<ClaudeInstructionsState> {
  if (!(await pathExists(statePath))) {
    return { managed: false }
  }

  try {
    const parsed = await readJson<ClaudeInstructionsState>(statePath)
    return {
      managed: parsed.managed === true,
    }
  } catch {
    return { managed: false }
  }
}

async function saveClaudeInstructionsState(
  statePath: string,
  state: ClaudeInstructionsState,
): Promise<void> {
  await writeJsonAtomic(statePath, state)
}

function normalizeClaudeInstructions(content: string): string {
  return content.replaceAll('\r\n', '\n').trim()
}

async function writeManagedFile(
  absolutePath: string,
  content: string,
  projectRoot: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const previous = await readTextOrEmpty(absolutePath)
  if (previous === content) return

  changed.push(toChangedEntry(projectRoot, absolutePath))

  if (check) return
  await writeTextAtomic(absolutePath, content)
}

function toChangedEntry(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath)
  if (relative.length === 0) return absolutePath
  if (relative.startsWith('..') || path.isAbsolute(relative)) return absolutePath
  return relative
}
