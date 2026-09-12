# System Architecture

Technical blueprint for advanced users.

## Problem

| Issue | Impact |
|:------|:-------|
| Different instruction formats | `.cursorrules`, `CLAUDE.md`, `AGENTS.md` |
| Different MCP configs | TOML, JSON, different schemas |
| Different skill packaging | Incompatible formats |

**Result:** Setup cost ↑, drift across teams ↑

## Solution

`agents` provides **one source of truth**:

| Component | Purpose |
|:----------|:--------|
| `AGENTS.md` | Instructions (all tools) |
| `CLAUDE.md` | Generated Claude Code wrapper that imports `AGENTS.md` |
| `.agents/agents.json` | MCP servers (shared) |
| `.agents/local.json` | Secrets (gitignored) |
| `.agents/skills/` | Reusable workflows |

## Core Principles

- ✅ Single source of truth in `.agents/`
- ✅ Root `AGENTS.md` is canonical
- ✅ One command setup: `agents start`
- ✅ Deterministic sync to tool configs
- ✅ Source-only git strategy (default)

## File Structure

```
project/
├── AGENTS.md                    # Instructions
├── CLAUDE.md                    # Generated wrapper for Claude Code
├── .agents/
│   ├── agents.json             # MCP servers (committed)
│   ├── local.json              # Secrets (gitignored)
│   ├── mcp_config.json         # Generated Antigravity CLI MCP
│   ├── skills/                 # Workflows
│   └── generated/              # Auto-generated (gitignored)
├── .codex/                     # Materialized (gitignored)
├── .claude/                    # Materialized (gitignored)
├── .cursor/                    # Materialized (gitignored)
└── ...
```

## Command Flow

| Command | What It Does |
|:--------|:-------------|
| `agents start` | Interactive setup + trust/approval confirmations |
| `agents status` | Check connection status |
| `agents doctor` | Validate configs |
| `agents sync` | Generate tool-specific configs |
| `agents watch` | Auto-sync on changes |
| `agents mcp add <url>` | Add MCP server |
| `agents mcp test --runtime` | Live connectivity check |
| `agents mcp budget` | Measure the context cost of each server |
| `agents profile use <name>` | Switch to a named subset of servers |
| `agents plugin export` | Package `.agents` as an Agent Plugins bundle |

## Integration Mapping

| Tool | Generated Config |
|:-----|:-----------------|
| **Codex** | `.codex/config.toml`, managed block only |
| **Claude Code** | `.mcp.json` (project scope) + root `CLAUDE.md` wrapper; `claude mcp add -s local` when `claudeScope` is `local` |
| **Claude Desktop** | Global `claude_desktop_config.json`, local stdio MCP only, preserving other entries |
| **Gemini** | `.gemini/settings.json` |
| **Cursor** | `.cursor/mcp.json` + CLI enable |
| **Copilot VS Code** | `.vscode/mcp.json` |
| **Copilot CLI** | `.mcp.json`, or `.github/mcp.json` when `copilotCliPath` says so |
| **Antigravity** | `.agents/mcp_config.json` workspace MCP |
| **Devin Desktop (Windsurf)** | Global `~/.codeium/windsurf/mcp_config.json`, preserving unmanaged entries |
| **OpenCode** | `opencode.json` (`mcp`) |
| **Junie** | `.junie/mcp/mcp.json` |
| **Grok Build** | `.grok/config.toml`, managed block only |
| **Amp** | `.amp/settings.json` (`amp.mcpServers`) |
| **Factory Droid** | `.factory/mcp.json` (`mcpServers`) |
| **Kilo** | `.kilo/kilo.jsonc` (`mcp`), comments preserved |
| **Devin CLI** | `.devin/mcp_config.json` (`mcpServers`) |
| **Zed** | `.zed/settings.json` (`context_servers`), comments preserved |
| **Goose** | `~/.config/goose/config.yaml` (`extensions`), secrets as `env_keys` |

### Files shared with the tool's own settings

Amp, Zed, Kilo, Gemini, OpenCode, Droid, Devin and Goose keep settings this CLI knows
nothing about in the same file. For those, sync owns only the entries it wrote: the
names are recorded in `.agents/generated/<tool>.state.json`, so a later run removes
exactly those and leaves everything else, including entries added by hand.

`.mcp.json` is a second kind of sharing: two different tools read the same file.
Claude Code (project scope) and Copilot CLI both do, so it is written once for both,
and `agents sync` reports that per-tool `targets` cannot isolate servers inside it.

## Claude Instructions

- `AGENTS.md` is the only canonical instruction source in the project.
- When Claude Code integration is enabled, `agents sync` manages a minimal root `CLAUDE.md` wrapper with:

```md
@AGENTS.md
```

- If a custom `CLAUDE.md` already exists, `agents` preserves it and stops managing Claude Code instructions for that project.

## Claude Desktop Caveat

- Claude Desktop sync is MCP-only; it does not manage skills or instruction files.
- Claude Desktop local JSON sync is stdio-only. HTTP/SSE MCP servers are skipped because Claude manages remote MCP as custom connectors.
- Claude Desktop may launch stdio MCP servers with an undefined working directory.
- Prefer absolute paths in Desktop-targeted `command`/`args` values and avoid relying on `cwd`.

## VS Code Integration

**Managed in `.vscode/settings.json`:**
```json
{
  "files.exclude": {
    "**/.codex": true,
    "**/.claude": true,
    "**/.cursor": true,
    "**/.gemini": true,
    "**/.antigravity": true,
    "**/.agents/mcp_config.json": true,
    "**/.windsurf": true,
    "**/.opencode": true,
    "**/.junie": true,
    "**/.mcp.json": true,
    "**/opencode.json": true,
    "**/.agents/generated": true
  }
}
```

**State tracking:** `.agents/generated/vscode.settings.state.json`

## Skills Sync

| Tool | Location |
|:-----|:---------|
| **Source** | `.agents/skills/**/SKILL.md` |
| **Codex** | Reads `.agents/skills/` directly |
| **Claude Code** | Symlink to `.claude/skills/` |
| **Cursor** | Symlink to `.cursor/skills/` |
| **Gemini** | Symlink to `.gemini/skills/` when Antigravity is disabled |
| **Antigravity** | Physical flat copy at `.gemini/skills`; nested source skills remain in `.agents/skills/` |
| **Windsurf** | Symlink to `.windsurf/skills/` |
| **Copilot CLI** | Reads `.agents/skills/` directly |
| **OpenCode** | Reads `.agents/skills/` directly |
| **Junie** | Symlink to `.junie/skills/` |
| **Kilo** | Symlink to `.kilo/skills/` |
| **Grok Build** | Reads `.agents/skills/` directly, once the folder is trusted |
| **Factory Droid** | Reads `.agents/skills/` directly |
| **Devin CLI** | Reads `.agents/skills/` directly |
| **Zed** | Reads `.agents/skills/` directly |
| **Goose** | Reads `.agents/skills/` directly |

**Nested skills.** A grouping directory (`.agents/skills/group-a/deploy-flow/`) is discovered
by this CLI and by most tools, but Zed only loads skills that sit directly under the skills
root, so `agents sync` warns when Zed is enabled and a skill is nested. Antigravity does not
read nested skills either, which is why it gets a flat copy instead of a symlink.

**Grok folder trust.** Grok ignores a project's MCP servers and its skills until the folder is
recorded in `~/.grok/trusted_folders.toml`, and reports nothing about it. `agents start` offers
to set it, `agents doctor` reports it and `agents doctor --fix` writes it.

**Validation:** `agents doctor` checks frontmatter (`name`, `description`, and the optional
`license`, `compatibility`, `metadata` and `allowed-tools`), and requires the frontmatter `name`
to match the skill's directory name, which Goose and Kilo need to load a skill at all.

## Reset Options

| Command | Effect |
|:--------|:-------|
| `agents reset` | Remove managed generated files and bridges, keep `.agents/` |
| `agents reset --local-only` | Remove managed tool files and bridges only |
| `agents reset --hard` | Remove all agents-managed setup (`.agents/`, `AGENTS.md`, managed `CLAUDE.md`, gitignore entries) |

## Security Model

| Type | Storage |
|:-----|:--------|
| **Shared config** | `.agents/agents.json` (committed) |
| **Secrets** | `.agents/local.json` (gitignored) |
| **Validation** | Fail-fast on invalid env/header keys |

**Rules:**
- ❌ No secrets in git
- ✅ Secrets in `.agents/local.json`
- ✅ `.agents/local.json` is written with owner-only permissions on supported filesystems
- ✅ Strict key validation (shell-safe for env, HTTP token for headers)

## Sync Process

```
1. Acquire the sync lock
2. Read .agents/agents.json, migrating the schema if needed
3. Merge with .agents/local.json
4. Apply the active profile, if one is set
5. Resolve ${PROJECT_ROOT}, ${VAR} and ${VAR:-default}
6. Render each enabled tool's format
7. Write atomically (temp + rename), merging into shared files
```

Warnings come only from integrations that are enabled, so a project without Goose is
never told how Goose handles secrets.

## Profiles

A profile names a subset of servers:

```json
{
  "profiles": {
    "ci": { "description": "Minimal set for pipelines", "servers": ["docs", "git"] }
  },
  "activeProfile": "ci"
}
```

`agents sync` uses `activeProfile`; `agents sync --profile ci` applies one for a single
run. A `--profile` naming something that does not exist is an error, because silently
syncing every server is the opposite of what was asked for.

## Entries in Global Configs

Claude Desktop, the global Windsurf config and the Goose config live in the home
directory and are shared by every project on the machine. Entries this CLI writes into
them are named `agents__<hash of the project path>__<server>`, so two projects that both
define a server called `fetch` keep their own entry and `agents reset` in one of them
does not remove the other's.

Project-local files keep the plain server name: nothing else writes them, and the name is
what the tool shows to the model.

Upgrading rewrites the bare entries a previous version wrote, taking the names from the
project's state file in `.agents/generated`. A project whose state file was deleted keeps
its old entries until they are removed by hand.

## Context Budget

`agents mcp budget` speaks MCP directly over stdio or streamable HTTP and reports tool
counts with an estimate of the context each server occupies, derived from the size of the
tool definitions.

**Protocol revisions.** The client speaks `2026-07-28`, which removed the `initialize`
handshake and the protocol-level session: every request carries its version, identity and
capabilities in `_meta`, and over HTTP in the `MCP-Protocol-Version` and `Mcp-Method`
headers. Servers built against `2025-11-25` and earlier still expect the handshake, so the
probe follows the detection the specification defines for a client that supports both:

| Transport | First attempt | Falls back when |
|:--|:--|:--|
| stdio | `server/discover` | the answer is an error that is not a reserved MCP code, or nothing arrives |
| Streamable HTTP | `tools/list` with the modern headers | the status is `400`, `404` or `405` and the body is not a recognized MCP error |

A reserved code identifies a modern server: `UnsupportedProtocolVersionError` (`-32022`)
lists the revisions it does support, and the probe continues with one of those rather than
falling back. When the only revisions offered are older than `2026-07-28`, the handshake is
used with the newest of them.

Servers whose configuration still contains an unresolved `${VAR}` are skipped rather
than started, and every probe has a timeout.

## Agent Plugins

`agents plugin export` writes an [Agent Plugins 1.0.0](https://agent-plugins.org/specification)
package: `plugin.json`, `mcp.json` and `skills/`. It reads `.agents/agents.json` only,
never `local.json`, so a package carries `${VAR}` placeholders instead of secrets.
`${PROJECT_ROOT}` becomes the specification's `${PLUGIN_ROOT}`.

`agents plugin import` goes the other way, prefixing imported server names with the
plugin name so nothing already defined is replaced.

## MCP Server Format

**stdio transport:**
```json
{
  "transport": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-filesystem", "/path"]
}
```

**http/sse transport:**
```json
{
  "transport": "http",
  "url": "https://api.example.com/mcp"
}
```

**With secrets:**
```json
{
  "transport": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}"
  }
}
```

## Git Strategy

**Committed:**
- ✅ `.agents/agents.json`
- ✅ `.agents/skills/`
- ✅ `AGENTS.md`

**Gitignored:**
- ❌ `CLAUDE.md` (source-only mode)
- ❌ `.agents/local.json`
- ❌ `.agents/generated/`
- ❌ `.agents/mcp_config.json`
- ❌ `.codex/`, `.claude/`, `.cursor/`, `.gemini/`
- ❌ `.windsurf/`, `.opencode/`, `.junie/`, `.mcp.json`, `opencode.json`
- ❌ `.grok/config.toml`, `.factory/mcp.json`, `.devin/mcp_config.json`

**Never gitignored, whatever the sync mode:** `.zed/settings.json`, `.amp/settings.json`,
`.kilo/kilo.jsonc` and `.github/mcp.json`. Those files hold the tool's own settings, or
belong in review, so the sync merges its entries into them and leaves the rest, and the
file's place in git is the team's decision.
- ❌ legacy `.antigravity/` (if present from older versions)

---

**Deep dive?** See [AGENTS.md](../AGENTS.md) for implementation details.
