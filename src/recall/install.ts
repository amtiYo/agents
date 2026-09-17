import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultAgentsConfig, saveAgentsConfig } from '../core/config.js'
import { copyFile, ensureDir, pathExists } from '../core/fs.js'
import { upsertMcpServers } from '../core/mcpCrud.js'
import { getHomeDir, getProjectPaths } from '../core/paths.js'
import { performSync } from '../core/sync.js'
import { INTEGRATION_IDS } from '../integrations/registry.js'
import type { SyncResult } from '../types.js'
import { ingest } from './ingest.js'
import { getRecallIndexPath } from './paths.js'
import type { RecallIngestResult } from './types.js'

export const RECALL_MCP_SERVER_NAME = 'agents-recall'

export interface RecallMcpLaunch {
  command: string
  args: string[]
}

export interface RecallInstallOptions {
  /** Machine home. Defaults to `getHomeDir()` (`AGENTS_HOME_DIR` / `os.homedir()`). */
  homeDir?: string
  /** Override the index sqlite path. */
  indexPath?: string
  /** Environment used to discover provider stores. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Node executable used to spawn `agents recall mcp`. */
  execPath?: string
  /** CLI argv, used to find the same binary that ran install (`process.argv[1]`). */
  argv?: string[]
  argv1?: string
  execArgv?: string[]
}

export interface RecallInstallResult {
  homeDir: string
  initialized: boolean
  skillPath: string
  indexPath: string
  mcp: { name: string } & RecallMcpLaunch
  ingest: RecallIngestResult
  sync: SyncResult
}

const DEFAULT_INTEGRATION_OPTIONS = {
  cursorAutoApprove: true,
  antigravityGlobalSync: true,
  claudeScope: 'project' as const,
  copilotCliPath: '.mcp.json' as const
}

function isAgentsCliEntry(filePath: string): boolean {
  const name = path.basename(filePath)
  return name === 'cli.js' || name === 'cli.ts' || name === 'cli.mjs' || name === 'agents'
}

/** `src/cli.ts` when running from TypeScript, `dist/cli.js` after compile. */
function packageCliEntry(): string {
  const here = fileURLToPath(import.meta.url)
  const ext = here.endsWith('.ts') ? '.ts' : '.js'
  return path.resolve(path.dirname(here), '..', `cli${ext}`)
}

function loaderFlags(execArgv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < execArgv.length; i += 1) {
    const flag = execArgv[i]
    if (flag === '--import' || flag === '--require' || flag === '--loader' || flag === '--experimental-loader') {
      out.push(flag)
      const next = execArgv[i + 1]
      if (next && !next.startsWith('-')) {
        out.push(next)
        i += 1
      }
      continue
    }
    if (
      flag.startsWith('--import=') ||
      flag.startsWith('--require=') ||
      flag.startsWith('--loader=') ||
      flag.startsWith('--experimental-loader=')
    ) {
      out.push(flag)
    }
  }
  return out
}

function hasTsLoader(flags: string[]): boolean {
  return flags.some((flag) => /tsx|ts-node|tsimp/i.test(flag))
}

/**
 * Canonical skill file shipped with the CLI (`templates/skills/recall/SKILL.md`).
 */
export function recallSkillTemplatePath(): string {
  const here = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(here), '../../templates/skills/recall/SKILL.md')
}

/**
 * Launch spec for `agents recall mcp`.
 *
 * Prefers the running CLI entry (`process.argv[1]`) so MCP clients spawn the same
 * binary that ran `install`. Loader flags such as `--import tsx` are kept; inspect
 * flags are not.
 */
export function resolveRecallMcpLaunch(
  options: {
    argv?: string[]
    argv1?: string
    execArgv?: string[]
    execPath?: string
  } = {},
): RecallMcpLaunch {
  const argv = options.argv ?? process.argv
  const argv1 = options.argv1 ?? argv[1]
  const flags = loaderFlags(options.execArgv ?? process.execArgv)

  let entry: string | undefined
  for (const candidate of [argv1, ...argv.slice(2)]) {
    if (candidate && isAgentsCliEntry(candidate)) {
      entry = path.resolve(candidate)
      break
    }
  }
  entry ??= packageCliEntry()

  if (entry.endsWith('.ts') && !hasTsLoader(flags)) {
    flags.push('--import', 'tsx')
  }

  return {
    command: options.execPath ?? process.execPath,
    args: [...flags, entry, 'recall', 'mcp']
  }
}

/**
 * Create `~/.agents` when missing, without writing `AGENTS.md` into the home
 * directory. A first-time install enables every integration so the following
 * sync can reach the same 18 tools as `agents start -g`.
 */
export async function ensureRecallAgentsHome(homeDir: string): Promise<{ initialized: boolean }> {
  const paths = getProjectPaths(homeDir)
  if (await pathExists(paths.agentsConfig)) {
    return { initialized: false }
  }

  await ensureDir(paths.agentsDir)
  await ensureDir(paths.agentsSkillsDir)
  await ensureDir(paths.generatedDir)
  await saveAgentsConfig(
    homeDir,
    createDefaultAgentsConfig({
      enabledIntegrations: [...INTEGRATION_IDS],
      integrationOptions: DEFAULT_INTEGRATION_OPTIONS,
      syncMode: 'source-only',
      hideGenerated: true,
      mcpServers: {}
    }),
  )
  return { initialized: true }
}

/** Copy the recall skill into `~/.agents/skills/recall/`, replacing a previous copy. */
export async function installRecallSkill(homeDir: string): Promise<string> {
  const paths = getProjectPaths(homeDir)
  const dest = path.join(paths.agentsSkillsDir, 'recall', 'SKILL.md')
  await copyFile(recallSkillTemplatePath(), dest)
  return dest
}

/** Register or replace the stdio MCP server that runs `agents recall mcp`. */
export async function registerRecallMcp(homeDir: string, launch: RecallMcpLaunch): Promise<void> {
  await upsertMcpServers({
    projectRoot: homeDir,
    replace: true,
    updates: [
      {
        name: RECALL_MCP_SERVER_NAME,
        server: {
          label: 'Agents Recall',
          description: 'Person shelves and search over local agent sessions',
          transport: 'stdio',
          command: launch.command,
          args: launch.args,
          enabled: true
        }
      }
    ]
  })
}

/**
 * Index local sessions, install the recall skill and MCP into `~/.agents`, then
 * run the existing global sync (`performSync` with home as the project root).
 *
 * Does not write into a project-local `.agents/` directory.
 */
export async function installRecall(
  options: RecallInstallOptions = {},
  onProgress?: (message: string) => void,
): Promise<RecallInstallResult> {
  const homeDir = options.homeDir ?? getHomeDir()
  const indexPath = options.indexPath ?? getRecallIndexPath(homeDir)
  const launch = resolveRecallMcpLaunch({
    argv: options.argv,
    argv1: options.argv1,
    execArgv: options.execArgv,
    execPath: options.execPath
  })

  onProgress?.('Indexing local agent sessions...')
  const ingestResult = await ingest({
    homeDir,
    indexPath,
    env: options.env
  })

  onProgress?.('Installing recall skill...')
  const { initialized } = await ensureRecallAgentsHome(homeDir)
  const skillPath = await installRecallSkill(homeDir)

  onProgress?.(`Registering ${RECALL_MCP_SERVER_NAME} MCP...`)
  await registerRecallMcp(homeDir, launch)

  onProgress?.('Syncing to configured tools...')
  const sync = await performSync({
    projectRoot: homeDir,
    check: false,
    verbose: false
  })

  return {
    homeDir,
    initialized,
    skillPath,
    indexPath,
    mcp: { name: RECALL_MCP_SERVER_NAME, ...launch },
    ingest: ingestResult,
    sync
  }
}
