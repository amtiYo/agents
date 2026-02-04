import path from 'node:path'
import { Command } from 'commander'
import { runConnect } from './commands/connect.js'
import { runDisconnect } from './commands/disconnect.js'
import { runDoctor } from './commands/doctor.js'
import { runInit } from './commands/init.js'
import { runStatus } from './commands/status.js'
import { runSync } from './commands/sync.js'

function resolvePath(input: string | undefined): string {
  return path.resolve(input ?? process.cwd())
}

async function main(): Promise<void> {
  const program = new Command()

  program
    .name('agents')
    .description('Manage AGENTS.md + MCP integrations across AI coding tools')
    .version('0.1.0')

  program
    .command('init')
    .description('Initialize .agents scaffold in a project')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--force', 'Overwrite existing scaffold files', false)
    .action(async (opts: { path: string; force: boolean }) => {
      await runInit({
        projectRoot: resolvePath(opts.path),
        force: Boolean(opts.force)
      })
    })

  program
    .command('connect')
    .description('Select AI integrations and sync configs')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--ai <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode')
    .option('--interactive', 'Open interactive selector')
    .option('--verbose', 'Print detailed sync output', false)
    .action(
      async (opts: { path: string; ai?: string; interactive?: boolean; verbose: boolean }) => {
        await runConnect({
          projectRoot: resolvePath(opts.path),
          ai: opts.ai,
          interactive: opts.interactive ?? !opts.ai,
          verbose: Boolean(opts.verbose)
        })
      },
    )

  program
    .command('disconnect')
    .description('Disable selected AI integrations and sync configs')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--ai <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode')
    .option('--interactive', 'Open interactive selector')
    .option('--verbose', 'Print detailed sync output', false)
    .action(
      async (opts: { path: string; ai?: string; interactive?: boolean; verbose: boolean }) => {
        await runDisconnect({
          projectRoot: resolvePath(opts.path),
          ai: opts.ai,
          interactive: opts.interactive ?? !opts.ai,
          verbose: Boolean(opts.verbose)
        })
      },
    )

  program
    .command('sync')
    .description('Generate and materialize client configs from .agents source-of-truth')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--check', 'Check for pending changes without writing', false)
    .option('--verbose', 'Print detailed sync output', false)
    .action(async (opts: { path: string; check: boolean; verbose: boolean }) => {
      await runSync({
        projectRoot: resolvePath(opts.path),
        check: Boolean(opts.check),
        verbose: Boolean(opts.verbose)
      })
    })

  program
    .command('status')
    .description('Show configured integrations and MCP status')
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
    .description('Validate setup and detect common issues')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--fix', 'Apply safe automatic fixes', false)
    .action(async (opts: { path: string; fix: boolean }) => {
      await runDoctor({
        projectRoot: resolvePath(opts.path),
        fix: Boolean(opts.fix)
      })
    })

  await program.parseAsync(process.argv)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
