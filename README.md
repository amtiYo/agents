# agents

[![npm version](https://img.shields.io/npm/v/agents-standard.svg)](https://www.npmjs.com/package/agents-standard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-77%20passing-brightgreen.svg)](https://github.com/amtiYo/agents)

> **One config to rule them all** — Stop maintaining separate configs for every AI coding tool. `agents` is a practical standard layer for multi-LLM development.

## 🎯 The Problem

Using multiple AI coding tools? You're probably doing this:

```text
.cursorrules           → Cursor instructions
.claude/mcp.json       → Claude Code MCP servers
.gemini/config.json    → Gemini CLI settings
.codex/config.toml     → Codex configuration
.vscode/mcp.json       → Copilot MCP servers
.antigravity/mcp.json  → Antigravity settings
CLAUDE.md              → Claude instructions
AGENTS.md              → Codex instructions
```

**Result:** Fragmentation, drift, broken onboarding, and wasted time.

## ✨ The Solution

`agents` gives you **one source of truth** that syncs to all tools:

```text
.agents/
  ├── agents.json      → MCP servers (all tools)
  ├── local.json       → Secrets (gitignored)
  └── skills/          → Reusable workflows

AGENTS.md              → Instructions (all tools)
```

**One command syncs everything:**
```bash
agents sync
```

## 🚀 Quick Start

### Install

```bash
npm install -g agents-standard
```

### Initialize your project

```bash
cd your-project
agents start
```

That's it! The interactive wizard will:
- ✅ Create `.agents/` structure
- ✅ Detect available tools (Codex, Claude, Cursor, etc.)
- ✅ Set up MCP server sync
- ✅ Configure AGENTS.md

## 💡 Key Features

### 🔄 One MCP server → All tools

```bash
# Add once, available everywhere
agents mcp add https://mcpservers.org/servers/context7-mcp

# Syncs to: Codex, Claude Code, Gemini CLI, Copilot, Cursor, Antigravity
agents sync
```

### 🛠️ Supported Tools (6+)

| Tool | MCP | Skills | Instructions |
|------|-----|--------|--------------|
| **Codex** | ✅ | ✅ | ✅ |
| **Claude Code** | ✅ | ✅ | ✅ |
| **Gemini CLI** | ✅ | ✅ | ✅ |
| **Cursor** | ✅ | ✅ | ✅ |
| **Copilot (VS Code)** | ✅ | ⏳ | ✅ |
| **Antigravity** | ✅ | ✅ | ✅ |

### 📊 Before & After

| Without `agents` | With `agents` |
|------------------|---------------|
| 6+ config files | **One `.agents/` folder** |
| Manual sync | **Automatic sync** |
| Per-tool MCP setup | **`agents mcp add` once** |
| Broken onboarding | **`agents start` for everyone** |
| Config drift | **Single source of truth** |

## 📚 Common Workflows

### Check project status
```bash
agents status
# Shows: connected tools, MCP servers, sync state

agents status --verbose
# Shows: full file paths, CLI probes, detailed info
```

### Add an MCP server
```bash
# From URL (auto-detects format)
agents mcp add https://mcpservers.org/servers/playwright-mcp

# Interactive mode
agents mcp add my-server --transport stdio

# From JSON file
agents mcp import --file servers.json
```

### Manage integrations
```bash
# Connect a tool
agents connect --llm cursor

# Disconnect a tool
agents disconnect --llm codex

# Connect multiple
agents connect --llm codex,claude,gemini
```

### Health checks
```bash
# Validate configuration
agents doctor

# Auto-fix issues (dry-run)
agents doctor --fix-dry-run

# Test MCP connectivity
agents mcp test --runtime
```

### Watch mode
```bash
# Auto-sync on changes
agents watch

# One-time check
agents watch --once
```

## 🏗️ Project Structure

After running `agents start`, you'll have:

```text
your-project/
├── AGENTS.md                    # Instructions (tracked in git)
├── .agents/
│   ├── README.md               # Documentation
│   ├── agents.json             # MCP servers (tracked in git)
│   ├── local.json              # Secrets (gitignored)
│   ├── skills/
│   │   ├── README.md
│   │   └── skill-guide/SKILL.md
│   └── generated/              # Auto-generated (gitignored)
│       └── vscode.settings.state.json
├── .codex/                     # Materialized (gitignored)
├── .claude/                    # Materialized (gitignored)
├── .gemini/                    # Materialized (gitignored)
├── .cursor/                    # Materialized (gitignored)
└── .vscode/mcp.json           # Materialized (gitignored)
```

**Git strategy:** Track `.agents/agents.json` and `AGENTS.md`, ignore everything else.

## 🔧 Advanced Usage

### Environment variables

```bash
# Override Codex config path (useful for testing)
export AGENTS_CODEX_CONFIG_PATH=/custom/path/codex.toml
```

### Reset options

```bash
# Safe reset: remove generated files, keep .agents/
agents reset

# Remove only materialized configs
agents reset --local-only

# Nuclear option: remove everything
agents reset --hard
```

### Sync validation

```bash
# Check for drift without syncing
agents sync --check

# Verbose sync output
agents sync --verbose
```

### Fast status checks

```bash
# Skip slow external CLI probes
agents status --fast

# JSON output (for scripts)
agents status --json
```

## 📖 Complete Command Reference

<details>
<summary><b>Click to expand all commands</b></summary>

### Core Commands

```bash
agents start [--path <dir>] [--non-interactive] [--yes]
agents init [--path <dir>] [--force]
agents connect [--path <dir>] [--llm <tools>] [--interactive]
agents disconnect [--path <dir>] [--llm <tools>] [--interactive]
agents sync [--path <dir>] [--check] [--verbose]
agents watch [--path <dir>] [--interval <ms>] [--once] [--quiet]
agents status [--path <dir>] [--json] [--verbose] [--fast]
agents doctor [--path <dir>] [--fix] [--fix-dry-run]
agents reset [--path <dir>] [--local-only] [--hard]
```

### MCP Commands

```bash
agents mcp list [--path <dir>] [--json]
agents mcp add [name] [--path <dir>] [options...]
agents mcp import [--path <dir>] [--file|--json|--url]
agents mcp remove <name> [--path <dir>] [--ignore-missing]
agents mcp test [name] [--path <dir>] [--runtime] [--json]
agents mcp doctor [name] [--path <dir>] [--runtime] [--json]
```

**MCP add options:**
- `--transport stdio|http|sse`
- `--command <cmd>` (for stdio)
- `--url <url>` (for http/sse)
- `--arg <value>` (repeatable)
- `--env KEY=VALUE` (repeatable)
- `--header KEY=VALUE` (repeatable)
- `--secret-env KEY=VALUE` (stored in local.json)
- `--secret-header KEY=VALUE` (stored in local.json)
- `--target <integration>` (specific tool only)
- `--replace` (overwrite if exists)

</details>

## 🤔 FAQ

<details>
<summary><b>Does this replace AGENTS.md?</b></summary>

**No!** `agents` extends AGENTS.md, not replaces it.

- **AGENTS.md** → Instructions for all tools
- **.agents/** → MCP servers, skills, config management
</details>

<details>
<summary><b>Can I use this with only one tool?</b></summary>

Yes! Even with one tool, `agents` provides:
- Easier MCP server management
- Better git strategy (track source, ignore generated)
- Health checks and validation
- Future-proof setup (easy to add more tools later)
</details>

<details>
<summary><b>How do I migrate from existing configs?</b></summary>

```bash
# 1. Install agents
npm install -g agents-standard

# 2. Initialize in your project
cd your-project
agents start

# 3. Import existing MCP servers
agents mcp import --file .claude/mcp.json

# 4. Sync to all tools
agents sync

# 5. Verify
agents status
```

Your old configs remain untouched. Test `agents`, then remove old configs when ready.
</details>

## 🎯 Why This Exists

**Problem:** LLM tooling ecosystem is moving fast, but standards are fragmented. Each vendor pushes different config formats.

**Solution:** `agents` gives teams a stable, repo-centric baseline that works across tools while staying compatible with [AGENTS.md](https://agents.md) (now stewarded by the [Agentic AI Foundation](https://openai.com/index/agentic-ai-foundation/) under Linux Foundation).

### Standards Alignment

- ✅ **AGENTS.md** — Instructions standard (Linux Foundation)
- ✅ **MCP (Model Context Protocol)** — Tool integration standard (Anthropic → Linux Foundation)
- ✅ **Agent Skills** — Reusable workflow conventions ([agentskills.io](https://agentskills.io))

`agents` is the practical implementation layer that makes these standards work together.

## 🗺️ Roadmap

### ✅ Released (v0.7.7)
- [x] 6 tool integrations (Codex, Claude, Gemini, Copilot, Cursor, Antigravity)
- [x] MCP server management (add, import, remove, test)
- [x] Auto-sync with drift detection
- [x] Health checks and validation
- [x] Atomic file writes (data safety)
- [x] Sync locking (race condition protection)
- [x] Interactive wizards

### 🚧 Next (v0.8.x)
- [ ] **Modular project memory** (agents load only needed context)
- [ ] Skills marketplace integration
- [ ] Migration toolkit (auto-import from legacy formats)
- [ ] Enhanced MCP server validation

### 🔮 Future (v0.9.x+)
- [ ] VSCode extension (GUI for config management)
- [ ] Team configs (shared across organization)
- [ ] Remote sync (cloud backup)
- [ ] Enterprise features (SSO, audit logs)
- [ ] Additional tool integrations (community-driven)

## 🤝 Contributing

**Huge request:** If this project helps you, please contribute!

- 🐛 [Report issues](https://github.com/amtiYo/agents/issues)
- 💡 [Suggest features](https://github.com/amtiYo/agents/discussions)
- 🔧 [Submit pull requests](https://github.com/amtiYo/agents/pulls)
- ⭐ Star the repo if you find it useful

Community feedback is the fastest way to turn this into a practical cross-tool standard.

### Development Setup

```bash
git clone https://github.com/amtiYo/agents.git
cd agents
npm install
npm run build
npm link

# Run tests
npm test

# Run in dev mode
npm run dev -- status
```

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test tests/mcp-commands.test.ts

# Watch mode
npm test -- --watch
```

**Test coverage:** 77 tests passing across 26 test suites.

## 📄 License

MIT License — See [LICENSE](LICENSE) file for details.

## 🔗 References

### Official Documentation
- [AGENTS.md](https://agents.md) — Instructions standard
- [Agent Skills](https://agentskills.io/home) — Skills registry
- [Model Context Protocol](https://modelcontextprotocol.io) — MCP specification

### Tool-Specific Docs
- [Codex: AGENTS.md](https://developers.openai.com/codex/guides/agents-md) | [MCP](https://developers.openai.com/codex/mcp) | [Skills](https://developers.openai.com/codex/skills)
- [Claude Code: MCP](https://code.claude.com/docs/en/mcp) | [Skills](https://code.claude.com/docs/en/skills)
- [Gemini CLI: MCP](https://geminicli.com/docs/tools/mcp-server/) | [Skills](https://geminicli.com/docs/cli/skills/)
- [Cursor: MCP](https://cursor.com/docs/context/mcp) | [Skills](https://cursor.com/docs/context/skills)
- [Antigravity: MCP](https://antigravity.google/docs/mcp) | [Skills](https://antigravity.google/docs/skills)

### Additional Resources
- [Agentic AI Foundation](https://openai.com/index/agentic-ai-foundation/) (Linux Foundation)
- [MCP Servers Registry](https://mcpservers.org)

---

<p align="center">
  <sub>Built with ❤️ for the AI coding community</sub><br>
  <sub>Making multi-LLM development simple, one config at a time</sub>
</p>
