# .agents

Project-local standard for AGENTS.md + MCP + SKILLS.

## Quick workflow
- `agents status` to inspect enabled integrations and MCP state.
- `agents mcp add <url-or-name>` to add one server for all selected tools.
- `agents mcp test --runtime` to validate connectivity.
- `agents sync` to materialize generated configuration.
- `agents sync --check` for CI-safe drift detection.

## Source files (commit these)
- `agents.json`: selected integrations + MCP servers + workspace behavior
- `skills/*/SKILL.md`: project skills

## Root instruction file
- `../AGENTS.md`: canonical instruction document

## Local/private files (do not commit)
- `local.json`: machine-specific MCP overrides and secrets

## Generated files
- `generated/*`: renderer outputs used by `agents sync`
- `generated/vscode.settings.state.json`: managed VS Code hide state

## Common materialized outputs
- `.codex/config.toml`
- `.gemini/settings.json`
- `.vscode/mcp.json`
- `.vscode/settings.json`
- `.cursor/mcp.json`
- `opencode.json`
- `.windsurf/skills/`
- `~/.codeium/windsurf/mcp_config.json` (global)
- `Antigravity User/mcp.json` (global)
