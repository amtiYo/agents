import path from 'node:path'
import { Command } from 'commander'
import { runConnect } from './commands/connect.js'
import { runDisconnect } from './commands/disconnect.js'
import { runDoctor } from './commands/doctor.js'
import { runInit } from './commands/init.js'
import { runMcpAdd } from './commands/mcp-add.js'
import { runMcpImport } from './commands/mcp-import.js'
import { runMcpList } from './commands/mcp-list.js'
import { runMcpRemove } from './commands/mcp-remove.js'
import { runMcpTest } from './commands/mcp-test.js'
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
    .version('0.7.1')

  program
    .command('start')
    .description('Guided setup wizard: init + integrations + MCP + skills + sync')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--non-interactive', 'Disable interactive wizard and use defaults', false)
    .option('--yes', 'Auto-confirm defaults (non-interactive)', false)
    .action(async (opts: { path: string; nonInteractive: boolean; yes: boolean }) => {
      await runStart({
        projectRoot: resolvePath(opts.path),
        nonInteractive: Boolean(opts.nonInteractive),
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
    .option('--llm <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode,cursor,antigravity')
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
    .option('--llm <list>', 'Comma-separated list: codex,claude,gemini,copilot_vscode,cursor,antigravity')
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
    .description('Show enabled integrations, MCP servers, files and probes')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--json', 'Output machine-readable JSON', false)
    .option('--verbose', 'Show full files/probes breakdown', false)
    .action(async (opts: { path: string; json: boolean; verbose: boolean }) => {
      await runStatus({
        projectRoot: resolvePath(opts.path),
        json: Boolean(opts.json),
        verbose: Boolean(opts.verbose)
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

  const mcp = program.command('mcp').description('Manage project MCP servers in .agents/agents.json')

  mcp
    .command('list')
    .description('List project MCP servers')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--json', 'Output machine-readable JSON', false)
    .action(async (opts: { path: string; json: boolean }) => {
      await runMcpList({
        projectRoot: resolvePath(opts.path),
        json: Boolean(opts.json)
      })
    })

  mcp
    .command('add [name]')
    .description('Add a project MCP server (or auto-import when [name] is a URL)')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--transport <type>', 'stdio|http|sse')
    .option('--command <cmd>', 'Command for stdio transport')
    .option('--arg <value>', 'Argument for stdio transport (repeatable)', collectOption, [])
    .option('--url <url>', 'URL for http/sse transport')
    .option('--env <KEY=VALUE>', 'Environment variable entry (repeatable)', collectOption, [])
    .option('--header <KEY=VALUE>', 'HTTP header entry (repeatable)', collectOption, [])
    .option('--secret-env <KEY=VALUE>', 'Secret env entry (stored in .agents/local.json)', collectOption, [])
    .option('--secret-header <KEY=VALUE>', 'Secret header entry (stored in .agents/local.json)', collectOption, [])
    .option('--secret-arg <index=value>', 'Secret arg by index (stored in .agents/local.json)', collectOption, [])
    .option('--target <integration>', 'Target integration (repeatable)', collectOption, [])
    .option('--description <text>', 'Server description')
    .option('--disabled', 'Create server as disabled', false)
    .option('--replace', 'Replace existing server with same name', false)
    .option('--no-sync', 'Skip automatic sync after update', false)
    .option('--non-interactive', 'Disable interactive prompts', false)
    .action(
      async (name: string | undefined, opts: {
        path: string
        transport?: string
        command?: string
        arg: string[]
        url?: string
        env: string[]
        header: string[]
        secretEnv: string[]
        secretHeader: string[]
        secretArg: string[]
        target: string[]
        description?: string
        disabled: boolean
        replace: boolean
        noSync: boolean
        nonInteractive: boolean
      }) => {
        await runMcpAdd({
          projectRoot: resolvePath(opts.path),
          name,
          transport: opts.transport,
          command: opts.command,
          args: opts.arg,
          url: opts.url,
          env: opts.env,
          headers: opts.header,
          secretEnv: opts.secretEnv,
          secretHeaders: opts.secretHeader,
          secretArgs: opts.secretArg,
          targets: opts.target,
          description: opts.description,
          disabled: Boolean(opts.disabled),
          replace: Boolean(opts.replace),
          noSync: Boolean(opts.noSync),
          nonInteractive: Boolean(opts.nonInteractive)
        })
      },
    )

  mcp
    .command('import')
    .description('Import MCP server definitions from JSON/JSONC or URL')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--file <path>', 'Load JSON/JSONC payload from file')
    .option('--json <text>', 'Inline JSON/JSONC payload')
    .option('--url <url>', 'Load MCP payload from URL (extract JSON snippet)')
    .option('--name <name>', 'Rename imported server (single-server import only)')
    .option('--target <integration>', 'Target integration override (repeatable)', collectOption, [])
    .option('--replace', 'Replace existing server(s) with the same name', false)
    .option('--no-sync', 'Skip automatic sync after update', false)
    .option('--non-interactive', 'Reserved for consistency with add flow', false)
    .action(
      async (opts: {
        path: string
        file?: string
        json?: string
        url?: string
        name?: string
        target: string[]
        replace: boolean
        noSync: boolean
        nonInteractive: boolean
      }) => {
        await runMcpImport({
          projectRoot: resolvePath(opts.path),
          file: opts.file,
          json: opts.json,
          url: opts.url,
          name: opts.name,
          targets: opts.target,
          replace: Boolean(opts.replace),
          noSync: Boolean(opts.noSync),
          nonInteractive: Boolean(opts.nonInteractive)
        })
      },
    )

  mcp
    .command('remove <name>')
    .description('Remove a project MCP server')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--ignore-missing', 'Do not fail if server does not exist', false)
    .option('--no-sync', 'Skip automatic sync after update', false)
    .action(async (name: string, opts: { path: string; ignoreMissing: boolean; noSync: boolean }) => {
      await runMcpRemove({
        projectRoot: resolvePath(opts.path),
        name,
        ignoreMissing: Boolean(opts.ignoreMissing),
        noSync: Boolean(opts.noSync)
      })
    })

  mcp
    .command('test [name]')
    .description('Validate MCP server definitions')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--json', 'Output machine-readable JSON', false)
    .action(async (name: string | undefined, opts: { path: string; json: boolean }) => {
      await runMcpTest({
        projectRoot: resolvePath(opts.path),
        name,
        json: Boolean(opts.json)
      })
    })

  mcp
    .command('doctor [name]')
    .description('Alias for "agents mcp test"')
    .option('--path <dir>', 'Target project directory', process.cwd())
    .option('--json', 'Output machine-readable JSON', false)
    .action(async (name: string | undefined, opts: { path: string; json: boolean }) => {
      await runMcpTest({
        projectRoot: resolvePath(opts.path),
        name,
        json: Boolean(opts.json)
      })
    })

  await program.parseAsync(process.argv)
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  process.exitCode = 1
})
