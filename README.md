# agents

`agents` is a practical standard layer for multi-LLM development.

Different vendors push different config formats for instructions, MCP, and skills.
That fragmentation creates noise, duplicated setup, and broken onboarding.

`agents` solves this by giving one project standard that can drive multiple LLM tools.
It **extends AGENTS.md**, not replaces it:
- AGENTS.md for instructions
- MCP servers for tools
- SKILLS for reusable workflows

## What it standardizes
- One project source-of-truth under `.agents/`
- One guided setup command: `agents start`
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
- Antigravity project-local MCP materialization is automatic

By default, the wizard preselects only one integration (Codex when available) to keep setup compact.

## `agent` vs `agents`
- `agents` is this project CLI.
- `agent` is a separate third-party CLI from the Cursor/Antigravity ecosystem.
- `antigravity` is the Antigravity CLI binary name in this project probes.
- If `agent status` prints account info, that is expected and unrelated to `agents status`.

## Commands
```bash
agents start [--path <dir>] [--non-interactive] [--yes]
agents init [--path <dir>] [--force]
agents connect [--path <dir>] [--llm codex,claude,gemini,copilot_vscode,cursor,antigravity] [--interactive]
agents disconnect [--path <dir>] [--llm codex,claude,gemini,copilot_vscode,cursor,antigravity] [--interactive]
agents sync [--path <dir>] [--check] [--verbose]
agents watch [--path <dir>] [--interval <ms>] [--once] [--quiet]
agents status [--path <dir>] [--json] [--verbose]
agents doctor [--path <dir>] [--fix]
agents reset [--path <dir>] [--local-only] [--hard]
agents mcp list [--path <dir>] [--json]
agents mcp add [name] [--path <dir>] [--transport stdio|http|sse] [--command <cmd>] [--arg <value>] [--url <url>] [--env KEY=VALUE] [--header KEY=VALUE] [--secret-env KEY=VALUE] [--secret-header KEY=VALUE] [--secret-arg index=value] [--target <integration>] [--replace]
agents mcp import [--path <dir>] [--file <json>] [--json <text>] [--url <url>] [--name <name>] [--target <integration>] [--replace]
agents mcp remove <name> [--path <dir>] [--ignore-missing]
agents mcp test [name] [--path <dir>] [--json]
agents mcp doctor [name] [--path <dir>] [--json]
```

## MCP toolkit (0.7.2)
- `agents mcp add`: add one server via flags or interactive prompts; if `[name]` is an `http(s)` URL, it auto-runs import flow.
- `agents mcp import`: import strict JSON/JSONC snippets (`--file`, `--json`, `--url`, or stdin).
- Interactive import now prompts for template secret values (tokens/keys) and lets you skip with Enter; skipped values can be added later in `.agents/local.json`.
- `agents mcp remove`: delete a server from `.agents/agents.json` + `.agents/local.json`.
- `agents mcp list`: inspect configured servers and local overrides.
- `agents mcp test`: validate transport/command/url/required env consistency.
- `agents mcp doctor`: alias for `agents mcp test`.

## Output UX
- `agents status` prints a compact summary by default.
- `agents status --verbose` prints full files/probes details.

## Project layout
```text
<project>/
  AGENTS.md
  .agents/
    README.md
    agents.json
    local.json
    skills/
      README.md
      skill-guide/SKILL.md
      <other-skills>/SKILL.md
    generated/
      vscode.settings.state.json
```

## Reset semantics
- `agents reset` (safe): removes generated/materialized integration files, keeps `.agents` source files.
- `agents reset --local-only`: removes only materialized tool configs.
- `agents reset --hard`: removes full agents-managed setup (`.agents`, root `AGENTS.md`, managed gitignore entries).

## Git strategy (default)
Default is `source-only`:
- keep `.agents/*` in git,
- ignore generated/local files (`.agents/generated`, `.agents/local.json`, `.codex`, `.gemini`, `.vscode/mcp.json`, `.claude/skills`, `.cursor`).

Optional Codex config path override (useful for tests):
```bash
export AGENTS_CODEX_CONFIG_PATH=/custom/path/codex.toml
```

Antigravity uses project-local materialization:
- `.antigravity/mcp.json`

## Codex visibility note
`codex mcp list` can differ from project-selected MCP in `.agents/agents.json`.
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
- https://agentskills.io/home
- https://cursor.com/docs/context/mcp
- https://cursor.com/docs/context/skills
- https://antigravity.google/docs/mcp
- https://antigravity.google/docs/skills
- https://developers.openai.com/codex/guides/agents-md
- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/skills
- https://geminicli.com/docs/cli/skills/
- https://geminicli.com/docs/tools/mcp-server/
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/skills
