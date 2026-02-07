# Quick Start Guide

Get up and running with `agents` in under 5 minutes.

## Prerequisites

- Node.js 20 or higher
- At least one AI coding tool installed:
  - [OpenAI Codex](https://developers.openai.com/codex)
  - [Claude Code](https://code.claude.com)
  - [Gemini CLI](https://geminicli.com)
  - [Cursor](https://cursor.com)
  - [GitHub Copilot](https://github.com/features/copilot) (VS Code)
  - [Antigravity](https://antigravity.google)

## Installation

```bash
npm install -g agents-standard
```

Verify installation:
```bash
agents --version
# Should output: 0.7.7
```

## First-Time Setup

### 1. Initialize your project

Navigate to your project directory:

```bash
cd your-project
agents start
```

The interactive wizard will:
- ✅ Create `.agents/` directory structure
- ✅ Detect which AI tools you have installed
- ✅ Set up initial configuration
- ✅ Create `AGENTS.md` (if it doesn't exist)
- ✅ Configure `.gitignore` rules

**Example output:**
```
┌  agents setup wizard
│
◆  Detected tools:
│  ✓ Codex (OpenAI)
│  ✓ Claude Code (Anthropic)
│  ✓ Cursor
│
◆  Initialize .agents/ directory?
│  Yes
│
◇  Created .agents/agents.json
◇  Created .agents/local.json
◇  Created .agents/skills/
◇  Created AGENTS.md
│
└  Setup complete! Run 'agents status' to verify.
```

### 2. Verify setup

```bash
agents status
```

You should see connected tools and their status.

### 3. Add your first MCP server

```bash
agents mcp add https://mcpservers.org/servers/context7-mcp
```

This will:
- Download the MCP server configuration
- Prompt for any required secrets (API keys, tokens)
- Add the server to `.agents/agents.json`

### 4. Sync to all tools

```bash
agents sync
```

This materializes your config to all connected tools:
- Codex → `.codex/config.toml`
- Claude → `.claude/mcp.json`
- Cursor → `.cursor/mcp.json`
- etc.

### 5. Verify MCP server is available

```bash
agents mcp list
```

You should see your newly added server.

## Common First Tasks

### Add multiple MCP servers at once

```bash
# Add from URLs
agents mcp add https://mcpservers.org/servers/playwright-mcp
agents mcp add https://mcpservers.org/servers/filesystem-mcp

# Or import from a JSON file
agents mcp import --file servers.json
```

### Connect additional tools

By default, `agents start` only connects one tool. To add more:

```bash
# Connect Cursor
agents connect --llm cursor

# Connect multiple at once
agents connect --llm claude,gemini
```

### Set up team config

Create a `.agents/agents.json` with your team's standard MCP servers, commit it to git:

```bash
# .agents/agents.json is tracked in git
git add .agents/agents.json AGENTS.md
git commit -m "Add agents config"
git push
```

Team members just need to:
```bash
git pull
agents start
# Secrets are prompted interactively
```

## Next Steps

### Health checks

```bash
# Validate all configurations
agents doctor

# Test MCP server connectivity
agents mcp test --runtime
```

### Auto-sync on changes

```bash
# Watch for changes and auto-sync
agents watch
```

Keep this running in a terminal while you work.

### Check for drift

```bash
# See if configs are out of sync
agents sync --check
```

## Troubleshooting

### `agents start` doesn't detect my tools

Make sure your tools are:
1. Installed globally or available in PATH
2. Properly configured (run `codex --version`, `claude --version`, etc.)

You can manually connect tools:
```bash
agents connect --llm codex,claude --interactive
```

### MCP server isn't showing up in my tool

1. Check if sync was successful:
   ```bash
   agents status --verbose
   ```

2. Verify MCP server config:
   ```bash
   agents mcp test my-server --runtime
   ```

3. Restart your AI tool (Cursor, Claude Code, etc.)

### Secrets not working

Secrets are stored in `.agents/local.json` (gitignored). To update:

```bash
# Edit directly
vim .agents/local.json

# Or re-add the server with --replace
agents mcp add my-server --replace
```

### Config drift between tools

```bash
# Check what's out of sync
agents sync --check

# Force re-sync
agents sync --verbose
```

## Migration from Existing Configs

### From Claude Code

```bash
# Import existing Claude MCP servers
agents mcp import --file ~/.claude/mcp.json

# Sync to all tools
agents sync
```

### From Cursor

```bash
# Import from Cursor config
agents mcp import --file ~/path/to/cursor/mcp.json

agents sync
```

### From Codex

Codex uses TOML format. Convert manually or use:

```bash
# Start fresh with agents
agents start

# Re-add servers from Codex UI or CLI
agents mcp add server-name --command "npx server" --arg "--port=3000"
```

## Pro Tips

### 1. Use `--fast` for quick checks

```bash
# Skip slow external CLI probes
agents status --fast
```

### 2. Dry-run before fixes

```bash
# Preview what doctor --fix would do
agents doctor --fix-dry-run
```

### 3. JSON output for scripts

```bash
# Machine-readable output
agents status --json | jq '.integrations'
```

### 4. Interactive MCP add

```bash
# Prompt for all options
agents mcp add my-server
```

Easier than remembering all the flags!

### 5. Target specific tools

```bash
# Add MCP server only for Cursor
agents mcp add my-server --target cursor
```

## Getting Help

- 📖 [Full Documentation](../README.md)
- 💬 [GitHub Discussions](https://github.com/amtiYo/agents/discussions)
- 🐛 [Report Issues](https://github.com/amtiYo/agents/issues)
- 📋 [Command Reference](./COMMANDS.md)

## What's Next?

- Learn about [Skills](./SKILLS.md)
- Understand [MCP Server Management](./MCP.md)
- Set up [Team Workflows](./TEAM_WORKFLOWS.md)
- Explore [Advanced Configuration](./ADVANCED.md)

---

**Need help?** Open an issue on [GitHub](https://github.com/amtiYo/agents/issues) or start a [discussion](https://github.com/amtiYo/agents/discussions).
