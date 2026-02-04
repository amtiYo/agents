# .agents directory

This folder contains all project-local AI agent configuration.

## Layout
- `AGENTS.md`: canonical project instructions.
- `config.json`: enabled integrations and sync metadata.
- `mcp/registry.json`: shared MCP source-of-truth.
- `mcp/local.json`: local overrides and secrets (gitignored).
- `generated/`: generated intermediate files (gitignored).

## Lifecycle
1. `agents connect` selects integrations.
2. `agents sync` renders integration-specific config files.
3. `agents status` shows what is configured.
4. `agents doctor` validates setup and can auto-fix safe issues.
