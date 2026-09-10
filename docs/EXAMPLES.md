# Usage Examples

Real-world scenarios.

## Solo Developer

**Scenario:** You use Cursor + Claude Code + Claude Desktop

```bash
cd ~/my-project
agents start

# Add MCP servers
agents mcp add https://mcpservers.org/servers/context7-mcp
agents mcp add https://mcpservers.org/servers/playwright-mcp

# Sync
agents sync
```

**Daily workflow:**
```bash
agents status        # Check sync status
agents watch         # Auto-sync changes
```

---

## Team Setup

**Lead sets up:**
```bash
agents start
agents connect --llm codex,claude,gemini

# Add company MCP servers
agents mcp add company-api \
  --url "https://api.company.com/mcp" \
  --secret-header "Authorization=Bearer YOUR_API_TOKEN"

# Commit
git add .agents/ AGENTS.md
git commit -m "Add agents config"
git push
```

**New member onboards:**
```bash
git pull
agents start  # Preserves team config and syncs local tool files
# Add local secrets in .agents/local.json if needed
# ✅ Done in 30 seconds
```

---

## Multiple Projects

**Project A (Frontend):**
```bash
cd ~/projects/frontend-app
agents init
agents connect --llm cursor
agents mcp add eslint-mcp --command npx --arg eslint-mcp-server
agents sync
```

**Project B (Backend):**
```bash
cd ~/projects/api-server
agents init
agents connect --llm claude,gemini
agents mcp add database-schema --command db-mcp-server
agents sync
```

Each project has its own `.agents/` config. No conflicts.

---

## Monorepo

**Root (company-wide servers):**
```bash
cd monorepo
agents init
agents mcp add company-auth --url "https://auth.company.com/mcp"
```

**Package (package-specific):**
```bash
cd packages/frontend
agents init
agents mcp add design-system --command design-mcp-server
```

**Result:** Inherit root config + add package-specific servers.

---

## Advanced MCP

### Add complex server with secrets

```bash
agents mcp add complex-api \
  --url "https://api.example.com/mcp" \
  --secret-header "Authorization=Bearer YOUR_OAUTH_TOKEN" \
  --secret-header "X-API-Key=YOUR_API_KEY" \
  --header "X-Client-Version=1.0.0"
```

Explicit `--secret-header` values are stored in `.agents/local.json`; committed config receives generated placeholders.

### Test before committing

```bash
# Add new server
agents mcp add experimental --url "https://new-api.com/mcp"

# Test
agents mcp test experimental --runtime

# If OK, commit
git add .agents/agents.json
git commit -m "Add experimental MCP"
```

### Target specific tool

```bash
# Claude-only server
agents mcp add claude-artifacts \
  --url "https://artifacts.anthropic.com/mcp" \
  --target claude

# Claude Desktop-only server
agents mcp add desktop-files \
  --command npx \
  --arg @modelcontextprotocol/server-filesystem \
  --arg /absolute/path/to/project \
  --target claude_desktop

# Universal server
agents mcp add context7 \
  --url "https://context7.com/mcp"

agents sync
```

**Result:**
- Claude Code: `claude-artifacts` + `context7` in `.mcp.json`
- Claude Desktop: `desktop-files` only through local JSON; add remote `context7` in Claude custom connectors or wrap it with a stdio bridge
- Cursor: `context7` only

Targets isolate a server everywhere except `.mcp.json`, which Claude Code and Copilot
CLI both read. With both enabled, everything in that file is visible to both, and the
sync says so.

---

## Scripting

### Rotate MCP token daily

```bash
#!/bin/bash
# rotate-mcp-token.sh

NEW_TOKEN=$(curl -s https://auth.company.com/token)
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

jq --arg token "$NEW_TOKEN" \
  '.mcpServers["company-api"].headers.Authorization = ("Bearer " + $token)' \
  .agents/local.json > "$tmp" && mv "$tmp" .agents/local.json

agents sync
```

### Status in shell prompt

Add to `.bashrc`:
```bash
agents_prompt() {
  if [ -d ".agents" ]; then
    MCP_COUNT=$(agents status --fast --json 2>/dev/null | jq -r '.mcp.configured')
    [ "${MCP_COUNT:-0}" -gt 0 ] && echo " 🟢" || echo " 🟡"
  fi
}

PS1='$(agents_prompt) '"$PS1"
```

---

## More Examples?

[Open a discussion](https://github.com/amtiYo/agents/discussions) and share your workflow!

---

## Devin Desktop + OpenCode

```bash
cd ~/my-project
agents init
agents connect --llm devin_desktop,opencode
agents sync
```

**Result:**
- Devin Desktop MCP is written to `~/.codeium/windsurf/mcp_config.json` (the data directory kept its name after the rename)
- OpenCode MCP is written to project `opencode.json`
- Skills are available from `.agents/skills` (Devin Desktop also gets `.windsurf/skills`)

---

## Terminal agents on one project

```bash
cd ~/my-project
agents connect --llm codex,claude,grok,amp,droid
agents sync
```

**Result:**
- Codex reads `.codex/config.toml`, Grok Build reads `.grok/config.toml`
- Claude Code reads `.mcp.json`, which is committed for the whole team
- Amp reads `.amp/settings.json` and finds skills in `.agents/skills` by itself
- Factory Droid reads `.factory/mcp.json`

Workspace MCP servers need approval in Amp before they run:

```bash
amp mcp approve context7
```

---

## Trimming context for CI

An agent in CI rarely needs every server, and each one costs context before any work
starts.

```bash
# What does the full set cost?
agents mcp budget

# Keep only what the pipeline uses
agents profile set ci --server git --server filesystem --description "Pipeline set"
agents sync --profile ci

# What does that cost?
agents mcp budget --profile ci
```

`agents profile use ci` makes the choice permanent for the project; `agents profile use`
with no name goes back to every server.

---

## Sharing a stack as a plugin

```bash
agents plugin export --name backend-stack --plugin-version 1.0.0 --out dist/backend-stack
agents plugin validate dist/backend-stack
```

The package is a directory with `plugin.json`, `mcp.json` and `skills/`, in the
[Agent Plugins 1.0.0](https://agent-plugins.org/specification) format that Codex, Cursor,
Copilot, Kiro and VS Code read. Push it to a git repository and other people install it
from there, or add it to another project directly:

```bash
agents plugin import ../backend-stack
```

Secrets never travel: the package carries the `${VAR}` placeholders from the committed
config, and the export prints which variables it needs.
