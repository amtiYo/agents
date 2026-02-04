# .agents

Project-local standard for AGENTS.md + MCP + SKILLS.

## Source files (commit these)
- `project.json`: selected LLM integrations + sync mode
- `AGENTS.md`: canonical instruction document
- `mcp/selection.json`: selected MCP ids
- `skills/*/SKILL.md`: project skills

## Local/private files (do not commit)
- `mcp/local.json`: machine-specific overrides and secrets

## Generated files
- `generated/*`: renderer outputs used by `agents sync`

## Where global defaults live
- Global catalog: `~/.config/agents/catalog.json`
- Override path with `AGENTS_CATALOG_PATH`
