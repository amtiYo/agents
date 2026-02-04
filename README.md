# agents

`agents` is a practical standard layer for multi-LLM development.

Different vendors push different config formats for instructions, MCP, and skills.
That fragmentation creates noise, duplicated setup, and broken onboarding.

`agents` solves this by giving one project standard that can drive multiple LLM tools.
It **extends AGENTS.md**, not replaces it:
- AGENTS.md for instructions
- MCP selection for tools
- SKILLS for reusable workflows

## What it standardizes
- One project source-of-truth under `.agents/`
- One guided setup command: `agents start`
- One global shared catalog for presets: `~/.config/agents/catalog.json`
- One sync command to materialize client configs: `agents sync`

## Supported tools (current)
- Codex
- Claude Code
- Gemini CLI
- Copilot VS Code (workspace MCP file)
- Cursor
- Antigravity

Kimi is intentionally out of scope for now until a stable project-local contract is available.

## Install (local development)
```bash
npm install
npm run build
npm link
```

## Main workflow
```bash
agents start
agents status
agents doctor
agents sync --check
```

`agents start` includes setup confirmations for trust/approval-sensitive integrations:
- Codex project trust
- Cursor MCP auto-approval
- Antigravity global MCP sync

## Commands
```bash
agents start [--path <dir>] [--non-interactive] [--profile <name>] [--yes]
agents init [--path <dir>] [--force]
agents connect [--path <dir>] [--llm codex,claude,gemini,copilot_vscode,cursor,antigravity] [--interactive]
agents disconnect [--path <dir>] [--llm codex,claude,gemini,copilot_vscode,cursor,antigravity] [--interactive]
agents sync [--path <dir>] [--check] [--verbose]
agents watch [--path <dir>] [--interval <ms>] [--once] [--quiet]
agents status [--path <dir>] [--json]
agents doctor [--path <dir>] [--fix]
agents reset [--path <dir>] [--local-only] [--hard]
```

## Project layout
```text
<project>/
  AGENTS.md -> .agents/AGENTS.md
  .agents/
    AGENTS.md
    README.md
    project.json
    mcp/
      selection.json
      local.json
      local.example.json
    skills/
      README.md
      skill-guide/SKILL.md
      <other-skills>/SKILL.md
    generated/
```

## Reset semantics
- `agents reset` (safe): removes generated/materialized integration files, keeps `.agents` source files.
- `agents reset --local-only`: removes only materialized tool configs.
- `agents reset --hard`: removes full agents-managed setup (`.agents`, root `AGENTS.md`, managed gitignore entries).

## Git strategy (default)
Default is `source-only`:
- keep `.agents/*` in git,
- ignore generated/local files (`.agents/generated`, `.agents/mcp/local.json`, `.codex`, `.gemini`, `.vscode/mcp.json`, `.claude/skills`, `.cursor`, `.antigravity`, `.agent/skills`).

## Global catalog
Default location:
- macOS/Linux: `~/.config/agents/catalog.json`
- Windows: `%APPDATA%/agents/catalog.json`

Override path with:
```bash
export AGENTS_CATALOG_PATH=/custom/path/catalog.json
```

Optional Codex config path override (useful for tests):
```bash
export AGENTS_CODEX_CONFIG_PATH=/custom/path/codex.toml
```

Optional Antigravity global MCP path override:
```bash
export AGENTS_ANTIGRAVITY_MCP_PATH=/custom/path/mcp.json
```

## Codex visibility note
`codex mcp list` can differ from project-selected MCP in `.agents`.
`agents status` shows both:
- project trust state (`codex_trust`)
- codex CLI list output

Use this command for the CLI-side view:
```bash
codex mcp list --json
```

## Why this exists
LLM tooling ecosystem is moving fast, but standards are fragmented.
`agents` gives teams a stable, repo-centric baseline that works across tools while staying compatible with AGENTS.md.

See `docs/agents-system.md` for the blueprint.

## Roadmap note
Planned next step: modular project memory under `.agents/` so agents can selectively load only the context they need for the current task.

## Skills interoperability
`agents` keeps skills in `.agents/skills` and validates basic `SKILL.md` frontmatter (`name`, `description`) in `agents doctor`.
This follows the direction of shared skill ecosystems (for example, Agent Skills registry conventions) while staying project-local.
Reference: https://agentskills.io/home

## Contributing
Huge request: if this project helps you, please contribute ideas, issue reports, and pull requests.
Community feedback is the fastest way to turn this into a practical cross-tool standard.

## References
- https://agents.md
- https://cursor.com/docs/context/mcp
- https://cursor.com/docs/cli/mcp
- https://cursor.com/docs/context/skills
- https://antigravity.google/docs/mcp
- https://antigravity.google/docs/skills
