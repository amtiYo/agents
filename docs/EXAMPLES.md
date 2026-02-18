# Usage Examples

Real-world scenarios.

## Solo Developer

**Scenario:** You use Cursor + Claude Code

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
  --secret-header "Authorization=Bearer {{API_TOKEN}}"

# Commit
git add .agents/ AGENTS.md
git commit -m "Add agents config"
git push
```

**New member onboards:**
```bash
git pull
agents start  # Prompts for API_TOKEN
# ✅ Done in 30 seconds
```

---

## Multiple Projects

**Project A (Frontend):**
```bash
cd ~/projects/frontend-app
agents init
agents connect --llm cursor
agents mcp add eslint-mcp --command "npx eslint-mcp-server"
agents sync
```

**Project B (Backend):**
```bash
cd ~/projects/api-server
agents init
agents connect --llm claude,gemini
agents mcp add database-schema --command "db-mcp-server"
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
agents mcp add design-system --command "design-mcp-server"
```

**Result:** Inherit root config + add package-specific servers.

---

## Advanced MCP

### Add complex server with secrets

```bash
agents mcp add complex-api \
  --url "https://api.example.com/mcp" \
  --secret-header "Authorization=Bearer {{OAUTH_TOKEN}}" \
  --secret-header "X-API-Key={{API_KEY}}" \
  --header "X-Client-Version=1.0.0"
```

Prompts for `OAUTH_TOKEN` and `API_KEY`. Stores in `.agents/local.json`.

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

# Universal server
agents mcp add context7 \
  --url "https://context7.com/mcp"

agents sync
```

**Result:**
- Claude: `claude-artifacts` + `context7`
- Cursor: `context7` only

---

## Scripting

### Rotate MCP token daily

```bash
#!/bin/bash
# rotate-mcp-token.sh

NEW_TOKEN=$(curl -s https://auth.company.com/token)

jq ".mcpServers.companyApi.env.API_TOKEN = \"$NEW_TOKEN\"" \
  .agents/local.json > .agents/local.json.tmp
mv .agents/local.json.tmp .agents/local.json

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

## Windsurf + OpenCode

```bash
cd ~/my-project
agents init
agents connect --llm windsurf,opencode
agents sync
```

**Result:**
- Windsurf MCP is written to `~/.codeium/windsurf/mcp_config.json`
- OpenCode MCP is written to project `opencode.json`
- Skills are available from `.agents/skills` (Windsurf also gets `.windsurf/skills`)
