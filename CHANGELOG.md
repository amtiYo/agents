# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- No changes yet.

## [0.8.6] - 2026-03-07

### Added

- New `agents start --reinit` flag for explicit project config reinitialization from the start flow.
- New `agents start --inject-docs` flag for non-interactive/CI flows to upsert an agents usage guide block into project docs.
- New starter skills in template scaffold:
  - `docs-research`
  - `mcp-troubleshooting`
- New integration coverage for stability fixes:
  - repeated `agents start` preserves existing config by default
  - `agents start --reinit` resets to selected/default setup
  - `syncMode` switch updates managed `.gitignore` entries correctly
  - copy-mode skills bridge drift is detected in `sync --check`
  - watch snapshot traversal tolerates transient filesystem races

### Changed

- `agents connect` is now additive: selected integrations are added to the existing enabled set instead of replacing it.
- `agents sync --check` is now strictly read-only (no lock acquisition, no directory creation, no file writes).
- Startup update notifications are now non-blocking best-effort checks so command execution is not delayed by network calls.
- Sync orchestration now uses integration hooks from `src/integrations/syncHooks.ts` for generated + materialized outputs.
- `agents start` interactive flow now asks whether to add an agents usage section to `README.md`/`CONTRIBUTING.md` and performs idempotent managed-block updates when enabled.
- Template scaffold docs now include a quick workflow section and expanded MCP/skills workflow guidance.
- `agents start` is now non-destructive by default when `.agents/agents.json` already exists (preserves integrations/MCP/workspace config unless `--reinit` is used).
- Managed `.gitignore` handling is now bidirectional across sync modes:
  - `source-only` adds managed source-only ignore entries
  - `commit-generated` removes only managed source-only entries while keeping base-managed and user custom lines
- Documentation/examples now use the correct repeatable `--arg` flag for stdio MCP commands and clarify onboarding behavior around local secrets.

### Fixed

- Fixed Commander wiring for `agents mcp add|import|remove --no-sync` (maps correctly to skip auto-sync).
- `agents watch --once` now sets a non-zero exit code on sync failure and quiet mode no longer suppresses errors.
- `agents watch --quiet` now correctly respects quiet mode for non-error output while still printing sync failures.
- `integrations.options.antigravityGlobalSync=false` now prevents writing Antigravity global MCP output while keeping generated snapshots.
- Disabling `integrations.options.antigravityGlobalSync` now also removes stale previously managed global Antigravity MCP output.
- `updateCheck` now falls back to global cache when project `.agents/local.json` is malformed, instead of overwriting the broken file.
- `updateCheck` now avoids writing stale project-local snapshots when `.agents/local.json` changes or becomes invalid during in-flight checks.
- Startup update checks now use a short best-effort timeout with no retry, avoiding long command shutdown delays on bad networks.
- `validateServerName` now rejects reserved names (`__proto__`, `prototype`, `constructor`).
- `agents mcp test --runtime-timeout-ms` now normalizes invalid values (`NaN`, `<=0`) to a safe default timeout.
- Sync lock now uses owner tokens and PID liveness checks to avoid unsafe stale-lock takeovers and foreign lock removal.
- `.gitignore` managed-entry matching now treats `/entry` and `entry` as equivalent to avoid duplicate managed lines.
- `loadAgentsConfig` now validates `syncMode` and falls back to `source-only` on invalid values.
- `upsertMcpServers` now removes stale local overrides when an update does not provide an override.
- VS Code managed exclude sync now forces managed keys to `true` when they exist as `false`.
- `start` now runs optional cleanup after final confirmation and handles Codex trust TOML parse failures as warnings.
- `start` now automatically reinitializes when an existing `.agents/agents.json` is malformed, instead of failing before setup.
- `CLI_VERSION` now resolves from `package.json` (single source of truth) with a safe fallback.
- Removed `removeIfExists` TOCTOU check and fixed `cleanupManagedBridge` async return clarity.
- Replaced raw verbose sync stdout writes with shared `ui.*` output helpers.
- `sync --check` now reports drift for managed copy-mode skills bridges (`.agents_bridge`) when bridge contents diverge from `.agents/skills`.
- `agents watch` no longer crashes on transient `ENOENT`/`EPERM`/`EACCES` races during snapshot traversal.
- Gemini config materialization warning path now uses sync warning aggregation instead of raw `console.warn`.
- `agents mcp import` output now goes through the shared UI pipeline instead of direct stdout writes.
- `agents update` no longer reports "Up to date" when the npm registry check fails and only stale cached metadata is available.
- Update checks now use a longer default timeout and retry once before falling back to cache, reducing false stale-cache results on slow networks.

### Removed

- Removed unused `LegacyProjectConfig` type.
- Removed unused `loadProjectConfig` / `saveProjectConfig` compatibility aliases.

## [0.8.5] - 2026-03-06

### Fixed

- `agents sync` no longer rewrites `lastSync` after `agents reset` or other output-only regeneration when project source inputs did not change.

## [0.8.4] - 2026-03-06

### Changed

- Project licensing has been switched from MIT to Apache 2.0, and a `NOTICE` file is now included.

### Fixed

- Claude integration now manages a root `CLAUDE.md` wrapper that references canonical `AGENTS.md` without duplicating instructions.
- `agents sync`, `agents status`, `agents doctor`, and `agents reset` now distinguish between agents-managed `CLAUDE.md` wrappers and custom user-owned `CLAUDE.md` files.
- `agents sync` no longer updates `lastSync` on idempotent runs when no managed drift is detected.

## [0.8.3] - 2026-02-18

### Added

- New integrations:
  - **Windsurf** MCP sync to global `~/.codeium/windsurf/mcp_config.json`
  - **OpenCode** MCP sync to project `opencode.json`
- Windsurf skills bridge support via `.windsurf/skills` (linked from `.agents/skills`).
- New renderer support for:
  - Windsurf `mcpServers` payload format
  - OpenCode top-level `mcp` payload with `local`/`remote` server modes
- New tests:
  - `tests/windsurf-opencode.integration.test.ts`
  - expanded renderer, MCP routing, target parsing, status, and reset coverage for new integrations

### Changed

- `agents connect/disconnect --llm` now accepts `windsurf` and `opencode`.
- Default MCP target expansion now includes Windsurf and OpenCode for legacy full target sets.
- Source-only gitignore and VS Code hidden-path defaults now include Windsurf/OpenCode outputs.
- `agents status`, `agents doctor`, `agents reset`, and `agents mcp test --runtime` now recognize Windsurf/OpenCode states.
- Project version bumped to `0.8.3`.

## [0.8.2] - 2026-02-17

### Added

- New `agents update` command:
  - human-readable version check
  - `--json` machine-readable output
  - `--check` exit-code mode (`0` up-to-date, `10` outdated, `1` check failure)
- New release workflow: `.github/workflows/release.yml` (manual publish + GitHub release notes from changelog).
- New test suites:
  - `tests/update-check.test.ts`
  - `tests/update.command.test.ts`

### Changed

- CLI now performs update availability checks before commands and prints a hint when a newer version is available.
- Added global `--no-update-check` flag and `AGENTS_NO_UPDATE_CHECK=1` escape hatch.
- Project version bumped to `0.8.2`.
- Shell command execution now has a default timeout to reduce hangs from external CLIs.

### Fixed

- `sync` no longer probes Claude CLI state when Claude integration is disabled.
- Antigravity MCP sync/status/doctor now use the global Antigravity profile `mcp.json` instead of requiring project-local `.antigravity/mcp.json`.
- `agents status` now reports integration-specific files only for integrations that are enabled.
- Antigravity-enabled projects now keep skills bridged through `.gemini/skills` even when Gemini integration is disabled.
- `tests/real-project-mcp.test.ts` now uses a timeout for Claude CLI probe to avoid hanging test runs.
- Fixed stale docs example that referenced a non-existent `.status` field in `agents status --json` output.

### Removed

- Removed GitHub Actions CI workflow (`.github/workflows/ci.yml`) and CI badge from README.

## [0.8.1] - 2026-02-14

### Fixed

- `agents start` no longer overwrites an existing root `AGENTS.md` during force scaffold refresh.
- `agents init --force` no longer overwrites an existing root `AGENTS.md`.
- Added safety handling for non-regular `AGENTS.md` paths (symlink/directory): scaffold skips overwrite and emits a warning.

### Added

- New integration tests for `AGENTS.md` overwrite protection:
  - `tests/init.integration.test.ts`
  - extended `tests/start-sync.integration.test.ts`

## [0.8.0] - 2026-02-09

### Added

- **New centralized UI module** (`src/core/ui.ts`) providing consistent formatting across all commands:
  - Unicode symbols with ASCII fallback for maximum terminal compatibility (✓ ✗ ⚠ ○ → •)
  - Minimalist color scheme (colors only for status indicators: success/error/warning/info)
  - Context-aware output respecting `--json`, `--quiet`, and `NO_COLOR` environment variable
  - Spinner wrapper for async operations using `@clack/prompts`
  - Layout helpers: `keyValue()`, `list()`, `statusList()`, `arrowList()`, `section()`, `hint()`, `nextSteps()`

- Spinners added to all commands with async operations:
  - `agents doctor` — diagnostics and fix application
  - `agents sync` — configuration syncing
  - `agents init` — project initialization
  - `agents reset` — cleanup operations
  - `agents mcp add` — server addition
  - `agents mcp remove` — server removal
  - `agents mcp test --runtime` — runtime health checks
  - `agents connect` / `agents disconnect` — integration updates

### Changed

- **Unified output formatting** across all 12 commands:
  - Colored status indicators (green ✓ for success, red ✗ for errors, yellow ⚠ for warnings)
  - Consistent key-value alignment in status output
  - Arrow-prefixed lists for changed/updated items
  - Improved visual hierarchy with proper spacing

- **Migrated `connect` and `disconnect` commands** from `prompts` library to `@clack/prompts` for consistent interactive experience.

- **Removed `prompts` dependency** — now using only `@clack/prompts` for all interactive prompts, reducing bundle size and ensuring consistent UX.

- **Improved error output** in CLI entry point with colored error symbol.

- CLI version bumped to `0.8.0`.

### Fixed

- `agents mcp test --json` now correctly sets `process.exitCode = 1` when validation fails.

## [0.7.7] - 2026-02-07

### Added

- `agents status --fast` to skip external CLI probes for quicker status checks.
- `agents doctor --fix-dry-run` to preview automatic fixes without mutating project files.
- Sync lock handling for `.agents/generated/sync.lock` to guard against concurrent sync runs.
- New shell-style argument tokenizer for interactive `agents mcp add` argument input.
- New test suites:
  - `tests/status.command.test.ts`
  - `tests/sync-lock.integration.test.ts`
  - `tests/shell-words.test.ts`

### Changed

- npm package publishing is now stricter and reproducible via:
  - `prepack` build hook
  - explicit `files` whitelist in `package.json`
- CI matrix now validates Node.js `20` and `22` across Linux, macOS, and Windows.
- Interactive `agents mcp add` now parses quoted/escaped args reliably instead of naive whitespace splitting.
- README command reference updated for `status --fast` and `doctor --fix-dry-run`.
- CLI version bumped to `0.7.7`.

### Fixed

- Reduced sync race conditions by introducing project-local sync lock acquisition before writes.
- URL-based MCP import now uses timeout + retry behavior, improving resilience to transient network failures.

## [0.7.6] - 2026-02-05

### Added

- `agents mcp test --runtime` and `--runtime-timeout-ms` for best-effort live MCP health checks via Claude, Gemini, and Cursor CLIs.
- Doctor now validates syntax for generated/materialized configs:
  - TOML: `.agents/generated/codex.config.toml`, `.codex/config.toml`
  - JSON: generated/materialized Gemini/Copilot/Cursor/Antigravity/Claude payloads
- New test suites:
  - `tests/mcp-test-runtime.integration.test.ts`
  - `tests/cursor-sync.integration.test.ts`
  - `tests/doctor.integration.test.ts`
  - `tests/sync-validation.integration.test.ts`

### Changed

- Codex renderer now includes URL-based MCP servers (`http` and legacy `sse`) instead of skipping non-stdio servers.
- Codex TOML output now quotes env/header keys safely and writes HTTP headers under `http_headers`.
- `agents mcp test` output now includes runtime details when `--runtime` is used.
- Cursor status parsing recognizes connection failures as an explicit `error` state.
- Cursor auto-approval sync no longer retries enable loops for `unknown/error` runtime statuses, improving idempotency.
- CLI version bumped to `0.7.6`.

### Fixed

- Prevented invalid env/header keys from producing broken Codex TOML:
  - fail-fast validation in `mcp add` and `mcp import`
  - fail-fast validation during `agents sync` for existing bad configs
- `agents doctor` now reports invalid MCP env/header keys as errors.
- Eliminated repeated `cursor-local-approval` drift in `agents sync --check` when Cursor reports persistent connection errors.

## [0.7.5] - 2026-02-05

### Fixed

- Resolved stale Claude MCP leftovers (`agents__*`) surviving across reset/start cycles.
- Sync now reconciles with actual `claude mcp list` managed entries before applying changes, so orphaned servers are removed automatically.

### Added

- New Claude CLI parser utility:
  - `src/core/claudeCli.ts`
- New tests:
  - `tests/claude-cli.test.ts`

### Changed

- Increased timeout for MCP commands integration test to stabilize environments where local CLI probes are slower.
- CLI version bumped to `0.7.5`.

## [0.7.4] - 2026-02-05

### Fixed

- `agents mcp add https://mcpservers.org/servers/appcontext-dev` now imports successfully.
- Import parser now handles MCP snippets provided as plain `<pre><code>...</code></pre>` blocks without a `language-json` class.

### Added

- Import payload support for direct name->server maps:
  - `{ "appcontext": { "url": "http://localhost:7777/sse", "type": "sse" } }`

### Changed

- `parseImportedServers` error/help text now documents the plain map payload shape.
- CLI version bumped to `0.7.4`.

## [0.7.3] - 2026-02-05

### Fixed

- Resolved a regression where `agents mcp add/import` could fail during sync with:
  - `Invalid environment variable value ... contains potentially dangerous characters`
- Placeholder values like `${GITHUB_TOKEN}` and real API keys containing punctuation now sync correctly to CLI integrations.
- Validation now blocks only control characters (the command runner uses `spawnSync` without a shell).

### Added

- New tests for MCP env/header validation behavior:
  - `tests/mcp-validation.test.ts`

### Changed

- CLI version bumped to `0.7.3`.

## [0.7.2] - 2026-02-05

### Added

- Interactive secret prompt during MCP import for template token/key values (for example `${GITHUB_TOKEN}`, `ghp_xxxx`):
  - asks immediately during `agents mcp import` / URL-driven `agents mcp add`
  - accepts Enter to skip and configure later
  - keeps placeholders in `.agents/agents.json`
  - stores only provided values in `.agents/local.json`

### Changed

- `splitServerSecrets` now supports placeholder-only secret keys/indexes without forcing local secret values.
- README clarifies Antigravity CLI naming (`antigravity`) and the new import-time secret prompt flow.
- CLI version bumped to `0.7.2`.

## [0.7.1] - 2026-02-05

### Added

- URL import fallback for `mcpservers.org` pages without JSON snippets:
  - detects linked GitHub repo
  - fetches README
  - extracts MCP JSON/JSONC code blocks automatically

### Changed

- `agents mcp import --file` now gives a clear validation error when a URL is passed (`--file` is local path only, use `--url` for websites).
- URL import error message now points users to the correct flows (`--url` for JSON pages, or explicit `--json` / `--file` snippets).

### Fixed

- `agents mcp add <mcpservers-url>` now works for pages like `cameroncooke/xcodebuildmcp` that previously failed extraction with “Could not extract MCP JSON payload from URL”.

## [0.7.0] - 2026-02-05

### Added

- `agents status --verbose` for full files/probes breakdown while default output is compact.
- `agents mcp doctor` alias for `agents mcp test`.
- New Cursor CLI parser helper (`src/core/cursorCli.ts`) for robust MCP status parsing.

### Changed

- CLI version bumped to `0.7.0`.
- `agents start` preflight now shows only actionable warnings (missing tools), reducing setup noise.
- Warning output across commands is now compacted and deduplicated.
- Cursor sync now self-heals approval drift: it checks `cursor-agent mcp list` and re-enables non-ready servers.
- Antigravity payload now includes both `servers` and `mcpServers` for compatibility.
- Status probe output is more reliable for Cursor (handles terminal control sequences correctly).

### Fixed

- Claude MCP sync no longer emits repeated "already exists in local config" warnings for already-managed servers.

## [0.6.0] - 2026-02-05

### Added

- New `agents mcp` toolkit for project-local MCP lifecycle:
  - `agents mcp list`
  - `agents mcp add`
  - `agents mcp import` (strict JSON/JSONC from file/inline/stdin/URL)
  - `agents mcp remove`
  - `agents mcp test`
- New MCP core helpers:
  - `src/core/mcpValidation.ts`
  - `src/core/mcpCrud.ts`
  - `src/core/mcpImport.ts`
  - `src/core/mcpSecrets.ts`
- New MCP-focused test suites:
  - `tests/mcp-import.test.ts`
  - `tests/mcp-crud.test.ts`
  - `tests/mcp-secrets.test.ts`
  - `tests/mcp-commands.integration.test.ts`
  - `tests/mcp-test.integration.test.ts`

### Changed

- CLI version bumped to `0.6.0`
- `agents mcp add <https://...>` now auto-detects URL input and delegates to import flow
- `agents status` now includes MCP totals and local override counts
- `agents doctor` now warns about unresolved MCP placeholders and likely secret literals in `.agents/agents.json`
- Sync security checks now reuse shared MCP validation helpers

## [0.5.0] - 2026-02-05

### Added

- New compact `.agents` format:
  - `.agents/agents.json`
  - `.agents/local.json`
  - `.agents/skills/*/SKILL.md`
  - `.agents/generated/*`
- Managed VS Code hiding for tool directories via `.vscode/settings.json` (JSONC merge)
- VS Code settings state tracking in `.agents/generated/vscode.settings.state.json`
- New test suite: `tests/vscode-settings.test.ts`

### Changed

- Root `AGENTS.md` is now canonical
- MCP registry is now project-local (no global catalog dependency)
- `agents start` simplified to project-local setup defaults
- Skills bridges now include Gemini (`.gemini/skills`) in addition to Claude and Cursor

### Removed

- `.agents/project.json`
- `.agents/mcp/selection.json`
- `.agents/mcp/local.json`
- `.agents/AGENTS.md`
- Global catalog/preset flow

## [0.4.1] - 2026-02-05

### Fixed

- **CRITICAL**: Fixed `namesToRemove` bug in Claude MCP sync ([src/core/sync.ts:277](src/core/sync.ts#L277))
  - Previously used `union` of current and desired servers instead of `difference`
  - This caused ALL servers (both current and desired) to be removed and re-added
  - Now correctly removes only servers that exist in current but not in desired

- **CRITICAL**: Added error handling for `JSON.parse` operations
  - [src/core/fs.ts:25](src/core/fs.ts#L25): Now provides helpful error messages when JSON parsing fails
  - [src/core/sync.ts:194](src/core/sync.ts#L194): Added handling for empty/invalid generated configs
  - [src/core/sync.ts:198-202](src/core/sync.ts#L198): Now warns about corrupted files instead of silently ignoring them

### Security

- Added server name validation to prevent command injection attacks
  - Server names must only contain alphanumeric characters, hyphens, underscores, colons, and dots
  - Prevents path traversal attempts with `..`
  - Applied to both Claude and Cursor sync operations

- Added environment variable and header value validation
  - Validates values in `addClaudeServer` before using them in CLI commands
  - Rejects values containing shell metacharacters: `` ` $ \ ; | & < > ( ) { } [ ] ! ``
  - Rejects values containing control characters

### Added

- New test suite: `tests/validation.test.ts`
  - Tests JSON parsing error handling with invalid and empty JSON files

- New test suite: `tests/real-project-mcp.test.ts`
  - Validates real MCP configuration (dogfooding)
  - Checks for `.claude` directory and settings
  - Queries `claude mcp list` to verify agents-managed servers
  - Provides informational output about project MCP status
  - Helps catch configuration drift and ensures tests run against real-world setups

- Added 10 new tests (total: 24 tests, up from 14)

### Changed

- Improved error messages for JSON parsing failures
  - Now includes file path and specific parse error
  - Distinguishes between file-not-found and corrupted file errors

## [0.4.0] - 2026-02-04

### Added

- Cursor and Antigravity support
- Complete onboarding with sync hub
- Trust flow for Codex

### Changed

- Bootstrap v1 with multi-tool MCP sync
- Improved integration handling

## [Earlier versions]

See git history for changes before 0.4.0.
