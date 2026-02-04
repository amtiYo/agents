# Reusable AGENTS System Blueprint

This is the reusable setup for any repository.

## Goal
Keep one canonical instruction file and one canonical MCP registry, then generate per-tool configs automatically.

## Canonical files
- `AGENTS.md` at project root: symlink (or copy fallback) to `.agents/AGENTS.md`
- `.agents/AGENTS.md`: full instruction source-of-truth
- `.agents/mcp/registry.json`: shared MCP source-of-truth
- `.agents/mcp/local.json`: non-committed local overrides/secrets

## Runtime commands
1. `agents init`
2. `agents connect`
3. `agents sync`
4. `agents status`
5. `agents doctor`

## Integration contracts (v1)
- Codex: writes `.codex/config.toml`
- Claude Code: manages local MCP via `claude mcp add/remove -s local`
- Gemini CLI: writes `.gemini/settings.json` and sets `context.fileName = AGENTS.md`
- Copilot VS Code: writes `.vscode/mcp.json`

## Secret policy
- Never commit secrets into `registry.json`.
- Put machine-specific values into `.agents/mcp/local.json` and environment variables.
- `local.json` must stay in `.gitignore`.

## Operational rules
- Edit MCP definitions only in `.agents/mcp/registry.json`.
- Run `agents sync` after every MCP change.
- Run `agents doctor` when MCP startup fails.
- Commit only deterministic source files and generated integration files you intentionally track.
