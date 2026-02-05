# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
