import path from 'node:path'
import { Command } from 'commander'
import { runConnect } from './commands/connect.js'
import { runDisconnect } from './commands/disconnect.js'
import { runDoctor } from './commands/doctor.js'
import { runInit } from './commands/init.js'
import { runReset } from './commands/reset.js'
import { runStart } from './commands/start.js'
import { runStatus } from './commands/status.js'
import { runSync } from './commands/sync.js'
import { runWatch } from './commands/watch.js'

function resolvePath(input: string | undefined): string {
  return path.resolve(input ?? process.cwd())
}

async function main(): Promise<void> {
  const program = new Command()

  program
    .name('agents')
    .description('Onboarding-first CLI for AGENTS.md + MCP + skills across LLM coding tools')
    .version('0.3.1')

  program
    .command('start')
    .description('Guided setup wizard: init + integrations + MCP + skills + sync')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--non-interactive', 'Disable interactive wizard and use defaults', false)
    .option('--profile <name>', 'MCP preset/profile id from global catalog')
    .option('--yes', 'Auto-confirm defaults (non-interactive)', false)
    .action(async (opts: { path: string; nonInteractive: boolean; profile?: string; yes: boolean }) => {
      await runStart({
        projectRoot: resolvePath(opts.path),
        nonInteractive: Boolean(opts.nonInteractive),
        profile: opts.profile,
        yes: Boolean(opts.yes)
      })
    })

  program
    .command('init')
    .description('Initialize .agents scaffold (without full guided setup)')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--force', 'Overwrite scaffold files when possible', false)
    .action(async (opts: { path: string; force: boolean }) => {
      await runInit({
        projectRoot: resolvePath(opts.path),
        force: Boolean(opts.force)
      })
    })

  program
    .command('connect')
    .description('Enable LLM integrations and sync')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--llm <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode')
    .option('--interactive', 'Open interactive selector')
    .option('--verbose', 'Print detailed sync output', false)
    .action(async (opts: { path: string; llm?: string; interactive?: boolean; verbose: boolean }) => {
      await runConnect({
        projectRoot: resolvePath(opts.path),
        llm: opts.llm,
        interactive: opts.interactive ?? !opts.llm,
        verbose: Boolean(opts.verbose)
      })
    })

  program
    .command('disconnect')
    .description('Disable LLM integrations and sync')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--llm <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode')
    .option('--interactive', 'Open interactive selector')
    .option('--verbose', 'Print detailed sync output', false)
    .action(async (opts: { path: string; llm?: string; interactive?: boolean; verbose: boolean }) => {
      await runDisconnect({
        projectRoot: resolvePath(opts.path),
        llm: opts.llm,
        interactive: opts.interactive ?? !opts.llm,
        verbose: Boolean(opts.verbose)
      })
    })

  program
    .command('sync')
    .description('Generate and materialize configs from .agents source-of-truth')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--check', 'Check for pending changes without writing files', false)
    .option('--verbose', 'Print detailed sync output', false)
    .action(async (opts: { path: string; check: boolean; verbose: boolean }) => {
      await runSync({
        projectRoot: resolvePath(opts.path),
        check: Boolean(opts.check),
        verbose: Boolean(opts.verbose)
      })
    })

  program
    .command('watch')
    .description('Watch .agents source files and auto-run sync on changes')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--interval <ms>', 'Polling interval in milliseconds', '1200')
    .option('--once', 'Run one sync pass and exit', false)
    .option('--quiet', 'Reduce periodic output', false)
    .action(async (opts: { path: string; interval: string; once: boolean; quiet: boolean }) => {
      await runWatch({
        projectRoot: resolvePath(opts.path),
        intervalMs: Number.parseInt(opts.interval, 10),
        once: Boolean(opts.once),
        quiet: Boolean(opts.quiet)
      })
    })

  program
    .command('status')
    .description('Show enabled integrations, MCP selection, files and probes')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--json', 'Output machine-readable JSON', false)
    .action(async (opts: { path: string; json: boolean }) => {
      await runStatus({
        projectRoot: resolvePath(opts.path),
        json: Boolean(opts.json)
      })
    })

  program
    .command('doctor')
    .description('Validate setup and detect configuration problems')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--fix', 'Apply safe automatic fixes', false)
    .action(async (opts: { path: string; fix: boolean }) => {
      await runDoctor({
        projectRoot: resolvePath(opts.path),
        fix: Boolean(opts.fix)
      })
    })

  program
    .command('reset')
    .description('Clean generated/materialized files safely')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--local-only', 'Clean only materialized integration files', false)
    .option('--hard', 'Remove all agents-managed setup (including .agents and root AGENTS.md)', false)
    .action(async (opts: { path: string; localOnly: boolean; hard: boolean }) => {
      await runReset({
        projectRoot: resolvePath(opts.path),
        localOnly: Boolean(opts.localOnly),
        hard: Boolean(opts.hard)
      })
    })

  await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
