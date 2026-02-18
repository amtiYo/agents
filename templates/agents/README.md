# .agents

Project-local standard for AGENTS.md + MCP + SKILLS.

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
