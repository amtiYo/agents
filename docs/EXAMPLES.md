# Usage Examples

Real-world examples of how to use `agents` in different scenarios.

## Table of Contents

- [Solo Developer](#solo-developer)
- [Team Setup](#team-setup)
- [Multiple Projects](#multiple-projects)
- [CI/CD Integration](#cicd-integration)
- [Monorepo Setup](#monorepo-setup)
- [Advanced MCP Management](#advanced-mcp-management)

---

## Solo Developer

### Scenario: You use Cursor and Claude Code

**Setup:**

```bash
cd ~/my-project
agents start
# Select: Cursor ✓, Claude Code ✓

# Add your favorite MCP servers
agents mcp add https://mcpservers.org/servers/context7-mcp
agents mcp add https://mcpservers.org/servers/playwright-mcp
agents mcp add filesystem --command "npx" --arg "@modelcontextprotocol/server-filesystem" --arg "/Users/you/docs"

# Sync to both tools
agents sync
```

**Daily workflow:**

```bash
# Morning: check everything is in sync
agents status

# Add a new MCP server
agents mcp add my-api --url "http://localhost:3000/mcp"

# Auto-sync (keep running in a terminal)
agents watch
```

**Result:** Edit `.agents/agents.json` once → Both Cursor and Claude Code get updates automatically.

---

## Team Setup

### Scenario: Your team uses Codex, Claude Code, and Gemini CLI

**Initial setup by team lead:**

```bash
cd company-repo
agents start

# Connect all team tools
agents connect --llm codex,claude,gemini

# Add company-wide MCP servers
agents mcp add company-api --url "https://api.company.com/mcp" --secret-header "Authorization=Bearer {{API_TOKEN}}"
agents mcp add database --command "company-mcp-server" --secret-env "DB_PASSWORD={{DB_PASSWORD}}"

# Commit to git
git add .agents/agents.json AGENTS.md .gitignore
git commit -m "Add agents config"
git push
```

**New team member onboarding:**

```bash
git clone https://github.com/company/repo.git
cd repo
agents start

# Wizard prompts for secrets (API_TOKEN, DB_PASSWORD)
# Enter team credentials
# ✓ All tools configured in 30 seconds
```

**Result:** Zero-friction onboarding. No more Slack messages asking "How do I configure Codex?"

---

## Multiple Projects

### Scenario: You work on 3 projects with different tool combinations

**Project A (Frontend) — Cursor only:**

```bash
cd ~/projects/frontend-app
agents init
agents connect --llm cursor
agents mcp add eslint-mcp --command "npx eslint-mcp-server"
agents sync
```

**Project B (Backend) — Claude Code + Gemini:**

```bash
cd ~/projects/api-server
agents init
agents connect --llm claude,gemini
agents mcp add database-schema --command "db-mcp-server"
agents mcp add api-docs --url "http://localhost:8080/mcp"
agents sync
```

**Project C (Full-stack) — All tools:**

```bash
cd ~/projects/full-stack
agents init
agents connect --llm codex,claude,gemini,cursor
agents mcp add context7 --url "https://context7.com/mcp"
agents mcp add playwright --url "https://playwright.dev/mcp"
agents sync
```

**Result:** Each project has its own `.agents/` config. No conflicts, no manual switching.

---

## CI/CD Integration

### Scenario: Validate MCP configs in CI pipeline

**.github/workflows/validate-agents.yml:**

```yaml
name: Validate Agents Config

on:
  pull_request:
    paths:
      - '.agents/**'
      - 'AGENTS.md'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install agents
        run: npm install -g agents-standard

      - name: Run doctor
        run: agents doctor --path .

      - name: Validate MCP servers
        run: agents mcp test --json --path .

      - name: Check sync
        run: agents sync --check --path .
```

**Result:** Catch config errors before merge. Enforce team standards automatically.

---

## Monorepo Setup

### Scenario: Monorepo with per-package MCP servers

```text
monorepo/
├── packages/
│   ├── frontend/
│   │   └── .agents/
│   │       └── agents.json (UI-specific MCP servers)
│   ├── backend/
│   │   └── .agents/
│   │       └── agents.json (API-specific MCP servers)
│   └── shared/
│       └── .agents/
│           └── agents.json (Common MCP servers)
└── .agents/ (Root config - company-wide servers)
```

**Root config (company-wide):**

```bash
cd monorepo
agents init
agents mcp add company-auth --url "https://auth.company.com/mcp"
agents sync
```

**Frontend package:**

```bash
cd packages/frontend
agents init
agents mcp add design-system --command "design-mcp-server"
agents mcp add storybook --url "http://localhost:6006/mcp"
agents sync
```

**Backend package:**

```bash
cd packages/backend
agents init
agents mcp add database --command "prisma-mcp-server"
agents mcp add redis --command "redis-mcp-server"
agents sync
```

**Workflow:**

```bash
# Work on frontend
cd packages/frontend
agents status
# → Shows: company-auth + design-system + storybook

# Work on backend
cd packages/backend
agents status
# → Shows: company-auth + database + redis
```

**Result:** Inherit root config, add package-specific servers. No duplication.

---

## Advanced MCP Management

### Example 1: Conditional MCP servers (dev vs prod)

**.agents/agents.json:**

```json
{
  "mcpServers": {
    "local-api": {
      "type": "sse",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**.agents/local.json (developer machine):**

```json
{
  "mcpServers": {
    "local-api": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

**.agents/local.json (CI environment):**

```json
{
  "mcpServers": {
    "local-api": {
      "url": "https://staging-api.company.com/mcp"
    }
  }
}
```

**Usage:**

```bash
# Local dev
agents sync
# Uses http://localhost:3000/mcp

# CI
export AGENTS_ENV=ci
agents sync
# Uses https://staging-api.company.com/mcp (if you implement env-based loading)
```

---

### Example 2: Import MCP servers from remote team config

**Scenario:** Your team maintains a central MCP registry

```bash
# Fetch team's standard servers
curl https://company.com/agents/mcp-servers.json > /tmp/team-servers.json

# Import into your project
agents mcp import --file /tmp/team-servers.json

# Verify
agents mcp list

# Sync to your tools
agents sync
```

**Automation:**

```bash
# Add to package.json scripts
{
  "scripts": {
    "sync-team-mcps": "curl -s https://company.com/agents/mcp-servers.json | agents mcp import --json -"
  }
}

# Team members run
npm run sync-team-mcps
agents sync
```

---

### Example 3: MCP server with complex secrets

**Scenario:** MCP server requires OAuth token + API key + custom headers

```bash
agents mcp add complex-api \
  --url "https://api.example.com/mcp" \
  --secret-header "Authorization=Bearer {{OAUTH_TOKEN}}" \
  --secret-header "X-API-Key={{API_KEY}}" \
  --header "X-Client-Version=1.0.0" \
  --secret-env "REFRESH_TOKEN={{REFRESH_TOKEN}}"
```

**Result:** Prompts for OAUTH_TOKEN, API_KEY, REFRESH_TOKEN. Stores securely in `.agents/local.json`.

**Update secrets later:**

```bash
# Edit .agents/local.json directly
vim .agents/local.json

# Or re-add with --replace
agents mcp add complex-api --replace
```

---

### Example 4: Test MCP servers before committing

```bash
# Add new server
agents mcp add experimental-server --url "https://new-api.com/mcp"

# Test static validation
agents mcp test experimental-server
# ✓ Transport: sse
# ✓ URL: valid
# ✓ Required env: none

# Test live connectivity
agents mcp test experimental-server --runtime
# ✓ Connected successfully
# ✓ Listed tools: [fetch, search, analyze]

# If tests pass, sync to tools
agents sync

# Verify in actual tool (e.g., Cursor)
# If it works, commit
git add .agents/agents.json
git commit -m "Add experimental-server MCP"
```

---

### Example 5: Per-tool MCP targeting

**Scenario:** Some MCP servers only work with specific tools

```bash
# Claude-only server (uses Claude-specific API)
agents mcp add claude-artifacts \
  --url "https://artifacts.anthropic.com/mcp" \
  --target claude

# Cursor-only server (uses Cursor features)
agents mcp add cursor-composer \
  --command "cursor-composer-mcp" \
  --target cursor

# Universal server (all tools)
agents mcp add context7 \
  --url "https://context7.com/mcp"

agents sync
```

**Result:**
- Claude Code: `claude-artifacts` + `context7`
- Cursor: `cursor-composer` + `context7`
- Codex: `context7` only

---

## Scripting with `agents`

### Example 6: Automated MCP server rotation

```bash
#!/bin/bash
# rotate-mcp-token.sh

# Update API token for MCP server
NEW_TOKEN=$(curl -s https://auth.company.com/token)

# Update local.json programmatically
jq ".mcpServers.companyApi.env.API_TOKEN = \"$NEW_TOKEN\"" \
  .agents/local.json > .agents/local.json.tmp
mv .agents/local.json.tmp .agents/local.json

# Re-sync
agents sync

echo "✓ MCP token rotated and synced"
```

**Cron job:**

```cron
# Rotate token daily
0 0 * * * cd /path/to/project && ./rotate-mcp-token.sh
```

---

### Example 7: Status check in shell prompt

Add to `.bashrc` or `.zshrc`:

```bash
agents_prompt() {
  if [ -d ".agents" ]; then
    STATUS=$(agents status --fast --json 2>/dev/null | jq -r '.status')
    if [ "$STATUS" = "synced" ]; then
      echo " 🟢"
    else
      echo " 🟡"
    fi
  fi
}

# Add to PS1/PROMPT
PS1='$(agents_prompt) '"$PS1"
```

**Result:** Your shell prompt shows 🟢 if agents config is synced, 🟡 if not.

---

## Tips & Tricks

### Quick health check

```bash
# One-liner: init, check, and report
agents status --fast || agents doctor --fix-dry-run
```

### Backup and restore

```bash
# Backup
tar czf agents-backup.tar.gz .agents/ AGENTS.md

# Restore
tar xzf agents-backup.tar.gz
agents sync
```

### Share config with colleague

```bash
# Export (without secrets)
agents mcp list --json > team-mcps.json

# Colleague imports
agents mcp import --file team-mcps.json
```

### Validate before git commit

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
if [ -d ".agents" ]; then
  agents doctor || exit 1
  agents sync --check || exit 1
fi
```

---

**More examples?** [Open a discussion](https://github.com/amtiYo/agents/discussions) and share your workflow!
