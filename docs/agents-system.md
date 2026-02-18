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
├── .agents/
│   ├── agents.json             # MCP servers (committed)
│   ├── local.json              # Secrets (gitignored)
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

## Integration Mapping

| Tool | Generated Config |
|:-----|:-----------------|
| **Codex** | `.codex/config.toml` |
| **Claude** | `claude mcp add -s local` (CLI) |
| **Gemini** | `.gemini/settings.json` |
| **Cursor** | `.cursor/mcp.json` + CLI enable |
| **Copilot** | `.vscode/mcp.json` |
| **Antigravity** | Global user profile `mcp.json` (not project-local) |
| **Windsurf** | Global user profile `~/.codeium/windsurf/mcp_config.json` |
| **OpenCode** | `opencode.json` (`mcp` block) |

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
    "**/.windsurf": true,
    "**/.opencode": true,
    "**/opencode.json": true,
    "**/.agents/generated": true
  }
}
```

**State tracking:** `.agents/generated/vscode.settings.state.json`

## Skills Sync

| Tool | Location |
|:-----|:---------|
| **Source** | `.agents/skills/*/SKILL.md` |
| **Codex** | Reads `.agents/skills/` directly |
| **Claude** | Symlink to `.claude/skills/` |
| **Cursor** | Symlink to `.cursor/skills/` |
| **Gemini** | Symlink to `.gemini/skills/` |
| **Antigravity** | Reuses `.gemini/skills/` bridge |
| **Windsurf** | Symlink to `.windsurf/skills/` |
| **OpenCode** | Reads `.agents/skills/` directly |

**Validation:** `agents doctor` checks frontmatter (`name`, `description`)

## Reset Options

| Command | Effect |
|:--------|:-------|
| `agents reset` | Remove generated files, keep `.agents/` |
| `agents reset --local-only` | Remove tool configs only |
| `agents reset --hard` | Remove everything (`.agents/`, `AGENTS.md`, gitignore entries) |

## Security Model

| Type | Storage |
|:-----|:--------|
| **Shared config** | `.agents/agents.json` (committed) |
| **Secrets** | `.agents/local.json` (gitignored) |
| **Validation** | Fail-fast on invalid env/header keys |

**Rules:**
- ❌ No secrets in git
- ✅ Secrets in `.agents/local.json`
- ✅ Strict key validation (shell-safe for env, HTTP token for headers)

## Sync Process

```
1. Read .agents/agents.json
2. Merge with .agents/local.json
3. Generate tool-specific configs
4. Write atomically (temp + rename)
5. Acquire lock (prevent race conditions)
```

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
  "env": {
    "API_KEY": "{{API_KEY}}"  // Prompt for value
  }
}
```

## Git Strategy

**Committed:**
- ✅ `.agents/agents.json`
- ✅ `.agents/skills/`
- ✅ `AGENTS.md`

**Gitignored:**
- ❌ `.agents/local.json`
- ❌ `.agents/generated/`
- ❌ `.codex/`, `.claude/`, `.cursor/`, `.gemini/`
- ❌ `.windsurf/`, `.opencode/`, `opencode.json`
- ❌ legacy `.antigravity/` (if present from older versions)

---

**Deep dive?** See [AGENTS.md](../AGENTS.md) for implementation details.
