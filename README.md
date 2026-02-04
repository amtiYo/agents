# agents CLI

`agents` is a standalone CLI for managing a project-local AGENTS.md setup and syncing MCP configs across AI coding tools.

## v1 scope
- Supported: `Codex`, `Claude Code`, `Gemini CLI`, `Copilot VS Code`
- Not in v1: `Kimi`, `Copilot GitHub cloud`

## Why Kimi is excluded in v1
At the moment we do not have a stable, documented, project-local MCP contract for Kimi CLI that matches the same automation guarantees as Codex/Claude/Gemini/Copilot VS Code. v1 focuses on integrations with mature local config + MCP workflows.

## Install (local dev)
```bash
npm install
npm run build
npm link
```

## Commands
```bash
agents init [--path <dir>] [--force]
agents connect [--path <dir>] [--ai codex,claude,...] [--interactive]
agents sync [--path <dir>] [--check] [--verbose]
agents status [--path <dir>] [--json]
agents doctor [--path <dir>] [--fix]
agents disconnect [--path <dir>] [--ai ...] [--interactive]
```

## Project layout after `agents init`
```text
<project>/
  AGENTS.md -> .agents/AGENTS.md
  .agents/
    AGENTS.md
    README.md
    config.json
    mcp/
      registry.json
      local.json
      local.example.json
    generated/
```

## How sync works
1. Reads `.agents/config.json` and `.agents/mcp/registry.json`.
2. Applies local overrides from `.agents/mcp/local.json`.
3. Renders generated files into `.agents/generated/`.
4. Materializes tool-specific configs:
- `.codex/config.toml`
- `.gemini/settings.json`
- `.vscode/mcp.json`
- Claude local MCP via `claude mcp add/remove -s local`

## AGENTS.md standard and docs
- AGENTS.md standard: https://agents.md/
- Codex docs: https://developers.openai.com/codex/
- Claude Code docs: https://code.claude.com/docs/en/overview
- Gemini CLI docs: https://geminicli.com/docs/
- VS Code MCP docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers

## Development
```bash
npm run lint
npm run test
npm run build
```

See `docs/agents-system.md` for the reusable cross-project blueprint.
