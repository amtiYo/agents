# Agents System Blueprint

## Problem
LLM toolchains have diverged into incompatible setup models:
- different instruction file expectations,
- different MCP config shapes,
- different skill packaging patterns.

This increases setup cost and causes drift across teams.

## Standard proposed by `agents`
`agents` defines a thin, repo-centric standard that aligns tools around:
1. AGENTS.md (instructions)
2. MCP servers (tooling)
3. Skills (reusable workflows)

## Core principles
- One source-of-truth in `.agents`
- Root `AGENTS.md` is canonical for all integrations
- One onboarding entrypoint (`agents start`)
- Deterministic sync into client-specific configs
- Source-only git strategy by default

## Canonical files
- `AGENTS.md`
- `.agents/agents.json`
- `.agents/local.json` (local/private)
- `.agents/skills/*/SKILL.md`

## Runtime flow
1. `agents start`
   - includes trust/approval confirmations for Codex and Cursor
   - asks whether to hide tool directories in VS Code
2. `agents status`
3. `agents doctor`
4. `agents sync --check`
5. Optional auto-sync loop: `agents watch`
6. MCP lifecycle via `agents mcp add|import|list|remove|test`
   - `agents mcp add <https://...>` auto-detects URL input and switches to import flow
   - `agents mcp doctor` is an alias for quick MCP validation

## Integration materialization
- Codex -> `.codex/config.toml`
- Claude -> `claude mcp add/remove -s local`
- Gemini -> `.gemini/settings.json`
- Copilot VS Code -> `.vscode/mcp.json`
- Cursor -> `.cursor/mcp.json` + `cursor-agent mcp enable/disable`
- Antigravity -> `.antigravity/mcp.json` (writes both `servers` and `mcpServers` keys for compatibility)

## VS Code visibility
- `agents sync` can manage `.vscode/settings.json` using JSONC merge.
- Managed keys:
  - `files.exclude`
  - `search.exclude`
- Default hidden paths:
  - `**/.codex`
  - `**/.claude`
  - `**/.gemini`
  - `**/.cursor`
  - `**/.antigravity`
  - `**/.agents/generated`
- Managed state file: `.agents/generated/vscode.settings.state.json`

## Reset model
- `agents reset` (safe): removes generated/materialized integration files, keeps `.agents` source files and `AGENTS.md`.
- `agents reset --local-only`: removes only materialized tool configs.
- `agents reset --hard`: removes full agents-managed setup and managed `.gitignore` entries.

## Skills model
- Canonical project skills in `.agents/skills`.
- Codex consumes these directly.
- Claude bridge at `.claude/skills` (symlink, copy fallback on restricted systems).
- Cursor bridge at `.cursor/skills` (symlink, copy fallback on restricted systems).
- Gemini bridge at `.gemini/skills` (symlink, copy fallback on restricted systems).
- `agents doctor` validates `SKILL.md` frontmatter (`name`, `description`) and naming conventions.

## Security model
- No secrets in committed source files.
- Secrets and machine specifics go into `.agents/local.json` and environment variables.
