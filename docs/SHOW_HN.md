# Show HN Post Template

## Title Options

Pick one (max 80 chars):

1. **Show HN: Agents – One config for all AI coding tools (Cursor, Claude, Codex, Gemini)**
2. **Show HN: Stop maintaining separate configs for Cursor, Claude, and Codex**
3. **Show HN: Agents Standard – Sync MCP servers across all AI coding tools**

Recommended: **#1** (clearest value prop)

## Post Body

```markdown
Hi HN! I built a CLI that solves the configuration fragmentation problem in multi-LLM development.

**The Problem:**

If you use multiple AI coding tools (Cursor, Claude Code, Codex, Gemini CLI, etc.), you're probably maintaining separate config files:

- `.cursorrules` → Cursor instructions
- `.claude/mcp.json` → Claude Code MCP servers
- `.codex/config.toml` → Codex configuration
- `.gemini/config.json` → Gemini CLI settings
- `AGENTS.md`, `CLAUDE.md` → Duplicated instructions

Changes get out of sync. Onboarding is painful. Adding an MCP server? Do it 6 times.

**The Solution:**

`agents` gives you one source of truth (`.agents/`) that syncs to all tools:

```bash
npm install -g agents-standard
cd your-project
agents start

# Add an MCP server once
agents mcp add https://mcpservers.org/servers/context7-mcp

# Syncs to all connected tools
agents sync
```

**Key Features:**

- **6 tool integrations:** Codex, Claude Code, Gemini CLI, Cursor, Copilot, Antigravity
- **One-command setup:** `agents start` (interactive wizard)
- **MCP management:** Add, import, test MCP servers with validation
- **Auto-sync:** Watch mode keeps configs in sync
- **Team-friendly:** Commit `.agents/agents.json`, teammates run `agents start`, done
- **Git strategy:** Track source files, ignore generated configs

**Standards Alignment:**

The project follows [AGENTS.md](https://agents.md) (now under Linux Foundation's Agentic AI Foundation) and [Model Context Protocol](https://modelcontextprotocol.io) (also contributed to Linux Foundation).

`agents` is the practical implementation layer that makes these standards work together.

**Tech Stack:**

- TypeScript + Node.js
- 77 tests passing (26 test suites)
- Atomic file writes, sync locking, race condition protection
- MIT licensed

**Looking for Feedback On:**

1. **Which tools should you see integrated next?**
2. **Is the CLI UX intuitive?** (Especially the interactive wizards)
3. **Enterprise features you'd need?** (Team configs, remote sync, SSO?)
4. **What pain points am I missing?**

**Try it:**

```bash
npm install -g agents-standard
agents --version
```

**Links:**

- npm: https://www.npmjs.com/package/agents-standard
- GitHub: https://github.com/amtiYo/agents
- Docs: https://github.com/amtiYo/agents#readme

Happy to answer questions and hear your thoughts!
```

---

## Timing Recommendations

**Best times to post on HN:**

- **Weekdays:** 8-10 AM EST (peak traffic)
- **Avoid:** Friday afternoons, weekends (lower engagement)
- **Optimal:** Tuesday or Wednesday morning

**Before posting:**

- [ ] Ensure npm package is published
- [ ] GitHub repo is public
- [ ] README is polished
- [ ] Tests pass on CI
- [ ] License file exists

---

## Expected Questions & Answers

### Q: "Why not just use [tool X]'s built-in config?"

**A:** Most teams use multiple tools. For example:
- Codex for code generation
- Claude Code for complex reasoning
- Cursor for UI/UX work

Managing 3+ configs manually is error-prone. `agents` solves this.

### Q: "What about vendor lock-in?"

**A:** Zero lock-in! Your `.agents/` configs are just JSON. The tool-specific configs are standard formats (TOML for Codex, JSON for Claude, etc.). You can stop using `agents` anytime and keep the generated configs.

### Q: "How does this compare to [some other tool]?"

**A:** There aren't direct competitors solving config sync across multiple LLM tools. Some tools (like `toad` CLI) unify LLM APIs, but don't solve the config fragmentation problem. `agents` is complementary.

### Q: "Does this work with private/self-hosted MCP servers?"

**A:** Yes! You can add any MCP server:

```bash
agents mcp add private-api --url "http://localhost:3000/mcp"
agents mcp add company-mcp --url "https://internal.company.com/mcp" --secret-header "Auth=Bearer {{TOKEN}}"
```

Secrets are stored in `.agents/local.json` (gitignored).

### Q: "What about Windows support?"

**A:** Fully supported! CI tests on Linux, macOS, and Windows with Node 20 & 22.

### Q: "Can I contribute?"

**A:** Absolutely! The project is MIT licensed. Biggest needs:
1. More tool integrations (community-driven)
2. Documentation improvements
3. Real-world usage feedback

Open an issue or PR on GitHub!

### Q: "Isn't this just a wrapper around existing CLIs?"

**A:** Partly, yes. But the value is in:
1. **Unified config format** across disparate tools
2. **Sync orchestration** (drift detection, atomic writes, locking)
3. **MCP server management** (import, test, validate)
4. **Team workflow** (commit once, teammates get config via `agents start`)

It's the "glue layer" that doesn't exist otherwise.

---

## Social Media Posts

### Twitter/X Thread

```
🚀 Tired of maintaining separate configs for Cursor, Claude Code, and Codex?

I built `agents` - a CLI that syncs them all from one source.

npm install -g agents-standard

Here's how it works 🧵

[1/8]

---

The problem:

You're using multiple AI coding tools. Each has its own config format:

.cursorrules
.claude/mcp.json
.codex/config.toml
.gemini/config.json

Changes get out of sync. Onboarding is a nightmare.

[2/8]

---

The solution:

One `.agents/` folder syncs to all tools.

$ agents start
$ agents mcp add <server-url>
$ agents sync

✓ Cursor updated
✓ Claude updated
✓ Codex updated
✓ Gemini updated

[3/8]

---

Real-world example:

Add an MCP server to 4 tools at once:

$ agents mcp add https://mcpservers.org/servers/context7-mcp

That's it. One command → available everywhere.

[4/8]

---

Team setup:

1. Lead: `agents start`, add MCP servers, commit `.agents/agents.json`
2. Teammate: `git pull && agents start`
3. Done. Zero manual config.

Onboarding went from 30 mins → 30 seconds.

[5/8]

---

Built with:

✅ TypeScript + Node.js
✅ 77 tests passing
✅ Atomic writes (no data corruption)
✅ Sync locking (no race conditions)
✅ MIT licensed

Follows AGENTS.md + MCP standards (both now under Linux Foundation).

[6/8]

---

Supported tools:

• Codex (OpenAI)
• Claude Code (Anthropic)
• Gemini CLI (Google)
• Cursor
• Copilot (VS Code)
• Antigravity

More integrations coming based on community feedback.

[7/8]

---

Try it:

npm install -g agents-standard
cd your-project
agents start

Docs: https://github.com/amtiYo/agents
npm: https://npmjs.com/package/agents-standard

Feedback welcome! 🙏

[8/8]
```

### Reddit Post (r/programming)

**Title:** [OC] Built a CLI to sync configs across AI coding tools (Cursor, Claude, Codex, etc.)

**Body:**

```markdown
**TL;DR:** If you use multiple AI coding tools, this CLI keeps their configs in sync from one source.

**The Problem:**

Using Cursor + Claude Code + Codex? You're maintaining:
- `.cursorrules`
- `.claude/mcp.json`
- `.codex/config.toml`

Add an MCP server → repeat 3 times. Configs drift. Onboarding is manual.

**The Solution:**

```bash
npm install -g agents-standard
cd your-project
agents start

# Add once, syncs to all tools
agents mcp add https://mcpservers.org/servers/playwright-mcp
agents sync
```

**Tech:**

- TypeScript + Node.js
- 77 tests, CI on Linux/macOS/Windows
- Follows AGENTS.md + MCP standards (Linux Foundation)
- MIT licensed

**GitHub:** https://github.com/amtiYo/agents

Looking for feedback on UX, features, and which tools to add next!
```

---

## Discord/Slack Communities

### Cursor Discord

**Channel:** #tools or #general

```
Hey folks! 👋

Built a CLI that might help if you use Cursor + other AI tools (Claude Code, Codex, Gemini).

Problem: Managing separate configs (.cursorrules, .claude/mcp.json, etc.) is tedious.

Solution: `agents` syncs configs from one source.

$ npm install -g agents-standard
$ agents start

Add an MCP server → it appears in Cursor, Claude, Codex, etc.

Open source (MIT): https://github.com/amtiYo/agents

Would love feedback! 🙏
```

### Claude Code Community

Similar message, tailored to Claude users.

---

## Follow-up Strategy

### Day 1-2 (Post Launch)

- [ ] Monitor HN comments, reply to all questions
- [ ] Respond on Reddit within 1-2 hours
- [ ] Engage on Twitter replies
- [ ] Update README based on feedback

### Week 1

- [ ] Address top feature requests
- [ ] Fix critical bugs
- [ ] Write blog post with detailed use cases
- [ ] Reach out to tool maintainers (Cursor, Claude) for potential collaboration

### Month 1

- [ ] Add 1-2 new tool integrations
- [ ] Implement top-voted features
- [ ] Release v0.8.0 with enhancements
- [ ] Write case study: "How [Company] Standardized AI Tooling"

---

**Questions or suggestions?** Open an issue or discussion on [GitHub](https://github.com/amtiYo/agents/discussions)!
