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
2. MCP selection (tooling)
3. Skills (reusable workflows)

## Core principles
- One source-of-truth in `.agents`
- One onboarding entrypoint (`agents start`)
- One global catalog for shared presets
- Deterministic sync into client-specific configs
- Source-only git strategy by default

## Canonical files
- `.agents/project.json`
- `.agents/AGENTS.md`
- `.agents/mcp/selection.json`
- `.agents/mcp/local.json` (local/private)
- `.agents/skills/*/SKILL.md`

## Global/shared layer
- `~/.config/agents/catalog.json`
- Defines MCP presets, MCP server definitions, skill packs, and baseline skills.

## Runtime flow
1. `agents start`
   - includes trust/approval confirmations for Codex, Cursor, and Antigravity
2. `agents status`
3. `agents doctor`
4. `agents sync --check`
5. Optional auto-sync loop: `agents watch`

## Integration materialization
- Codex -> `.codex/config.toml`
- Claude -> `claude mcp add/remove -s local`
- Gemini -> `.gemini/settings.json`
- Copilot VS Code -> `.vscode/mcp.json`
- Cursor -> `.cursor/mcp.json` + `cursor-agent mcp enable/disable`
- Antigravity -> `.antigravity/mcp.json` + managed entries in global Antigravity MCP profile

## Reset model
- Safe reset keeps source-of-truth and removes local/generated outputs.
- Hard reset removes full agents-managed setup and gitignore managed entries.

## Skills model
- Canonical project skills in `.agents/skills`
- Codex consumes these directly.
- Claude bridge at `.claude/skills` (symlink, copy fallback on restricted systems).
- Cursor bridge at `.cursor/skills` (symlink, copy fallback on restricted systems).
- Antigravity bridge at `.agent/skills` (symlink, copy fallback on restricted systems).
- `agents doctor` validates `SKILL.md` frontmatter (`name`, `description`) and naming conventions.

## Security model
- No secrets in committed source files.
- Secrets and machine specifics go into `.agents/mcp/local.json` and environment variables.
