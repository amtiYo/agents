# 🚀 Launch Checklist

Final pre-launch checklist for `agents-standard` v0.7.7

## ✅ Completed

### Package Preparation
- [x] **npm name verified:** `agents-standard` is available
- [x] **package.json updated:** Name, description, keywords, repository links
- [x] **README.md polished:** Clear value prop, badges, examples, FAQ
- [x] **Documentation created:**
  - [x] `docs/QUICK_START.md` — 5-minute getting started guide
  - [x] `docs/EXAMPLES.md` — Real-world usage examples
  - [x] `docs/PUBLISHING.md` — Publishing instructions
  - [x] `docs/SHOW_HN.md` — Social media templates
- [x] **Tests passing:** 77 tests across 26 suites ✅
- [x] **Build working:** TypeScript compiles without errors ✅
- [x] **License:** MIT (already exists) ✅

## 📋 Pre-Publish Steps

### 1. Final Validation

```bash
# Build and test
npm run build
npm run test
npm run lint

# Check package contents
npm pack --dry-run

# Test CLI locally
npm link
agents --version
agents status
npm unlink
```

**Expected:** All green, no errors.

---

### 2. Update GitHub Repository

**If GitHub repo doesn't exist yet:**

```bash
# Create on GitHub first: https://github.com/new
# Then:
git remote add origin https://github.com/amtiYo/agents.git
git branch -M main
git push -u origin main
```

**If repo exists but needs update:**

```bash
# Commit latest changes
git add .
git commit -m "docs: polish README and add launch documentation"
git push origin main
```

**Make repo public** (if private):
- Go to: `https://github.com/amtiYo/agents/settings`
- Scroll to "Danger Zone"
- Click "Change visibility" → "Make public"

---

### 3. Publish to npm

```bash
# Login to npm (if not already)
npm login

# Verify you're logged in
npm whoami

# Publish (dry-run first)
npm publish --dry-run

# If all looks good, publish for real
npm publish --access public
```

**Expected output:**
```
+ agents-standard@0.7.7
```

**Verify:**
```bash
npm view agents-standard
```

---

### 4. Create GitHub Release

**Option A: Via Web UI**

1. Go to: `https://github.com/amtiYo/agents/releases/new`
2. **Tag:** `v0.7.7`
3. **Title:** `v0.7.7 — Initial Public Release`
4. **Description:**

```markdown
## 🎉 Initial Public Release

`agents-standard` is now available on npm!

```bash
npm install -g agents-standard
```

### What's Included

- ✅ 6 tool integrations: Codex, Claude Code, Gemini CLI, Cursor, Copilot, Antigravity
- ✅ MCP server management (add, import, test, remove)
- ✅ Auto-sync with drift detection
- ✅ Interactive setup wizard
- ✅ Health checks and validation
- ✅ 77 passing tests

### Quick Start

```bash
cd your-project
agents start
agents mcp add https://mcpservers.org/servers/context7-mcp
agents sync
```

### Documentation

- 📖 [README](https://github.com/amtiYo/agents#readme)
- 🚀 [Quick Start Guide](docs/QUICK_START.md)
- 💡 [Usage Examples](docs/EXAMPLES.md)

### Links

- **npm:** https://www.npmjs.com/package/agents-standard
- **Issues:** https://github.com/amtiYo/agents/issues
- **Discussions:** https://github.com/amtiYo/agents/discussions

---

**Full changelog:** [CHANGELOG.md](CHANGELOG.md)
```

5. Click **"Publish release"**

**Option B: Via CLI**

```bash
git tag v0.7.7
git push origin v0.7.7

# Use gh CLI
gh release create v0.7.7 --title "v0.7.7 — Initial Public Release" --notes-file docs/release-notes.md
```

---

## 🌍 Launch Day Tasks

### Morning (8-10 AM EST recommended)

#### 1. Verify Everything is Live

- [ ] npm: https://www.npmjs.com/package/agents-standard
- [ ] GitHub: https://github.com/amtiYo/agents
- [ ] README badges show correct version
- [ ] Test install: `npm install -g agents-standard`

#### 2. Post on Hacker News

- [ ] Go to: https://news.ycombinator.com/submit
- [ ] **Title:** `Show HN: Agents – One config for all AI coding tools (Cursor, Claude, Codex, Gemini)`
- [ ] **URL:** `https://github.com/amtiYo/agents`
- [ ] **Body:** Use template from `docs/SHOW_HN.md`
- [ ] Click "Submit"

**After posting:**
- [ ] Monitor comments every 30 mins for first 2 hours
- [ ] Reply to all questions promptly
- [ ] Be helpful, not defensive
- [ ] Thank people for feedback

#### 3. Post on Reddit

**r/programming:**

- [ ] Go to: https://www.reddit.com/r/programming/submit
- [ ] **Title:** `[OC] Built a CLI to sync configs across AI coding tools (Cursor, Claude, Codex, etc.)`
- [ ] **Body:** Use template from `docs/SHOW_HN.md`
- [ ] Add flair: `[Project]` or `[Open Source]`
- [ ] Post

**r/MachineLearning:**

- [ ] Similar post, focus on ML/AI angle
- [ ] Title: `[P] Agents Standard – Config sync for multi-LLM development`

**r/LocalLLaMA (optional):**

- [ ] Community for local AI tools

#### 4. Twitter/X Thread

- [ ] Use thread from `docs/SHOW_HN.md`
- [ ] Post first tweet
- [ ] Reply to yourself with thread (1/8, 2/8, etc.)
- [ ] Use hashtags: `#AI #Coding #LLM #OpenSource #CLI`
- [ ] Tag relevant accounts (optional): `@cursor_ai @AnthropicAI @OpenAI`

#### 5. Discord/Slack Communities

**Cursor Discord:**
- [ ] Channel: `#tools` or `#general`
- [ ] Use template from `docs/SHOW_HN.md`

**Claude Community (if exists):**
- [ ] Post announcement

**AI Engineering Slack/Discords:**
- [ ] Share in relevant channels

---

### Throughout the Day

- [ ] Monitor HN ranking (aim for front page)
- [ ] Respond to comments/questions
- [ ] Track npm downloads: `npm view agents-standard`
- [ ] Monitor GitHub stars/issues
- [ ] Collect feedback in a doc for future improvements

---

### Evening (6-8 PM)

#### 6. Write Launch Recap

Create `docs/LAUNCH_RECAP.md`:

```markdown
# Launch Day Recap

## Metrics
- HN: [points] points, [rank] on front page, [comments] comments
- Reddit: [upvotes] upvotes, [comments] comments
- Twitter: [likes] likes, [retweets] RTs, [replies] replies
- npm: [downloads] downloads
- GitHub: [stars] stars, [issues] issues

## Top Feedback
1. [Most common request]
2. [Second most common]
3. [Interesting use case mentioned]

## Action Items
- [ ] [Feature request #1]
- [ ] [Bug report #1]
- [ ] [Documentation improvement]
```

---

## Week 1 Follow-up

### Day 2-3

- [ ] Address critical bugs (if any)
- [ ] Reply to all GitHub issues
- [ ] Update README based on FAQ questions
- [ ] Write follow-up post: "Show HN: [Update] - Top Requested Feature Added"

### Day 4-7

- [ ] Implement 1-2 most-requested features
- [ ] Write blog post: "Building Agents: Lessons from Launch Week"
- [ ] Reach out to tool maintainers (Cursor, Claude) for collaboration
- [ ] Plan v0.8.0 roadmap based on feedback

---

## Success Metrics

### Minimum Viable Success (Week 1)

- [ ] 50+ npm downloads
- [ ] 20+ GitHub stars
- [ ] 5+ issues/discussions opened
- [ ] HN front page (even briefly)

### Strong Success (Week 1)

- [ ] 200+ npm downloads
- [ ] 100+ GitHub stars
- [ ] 20+ issues/discussions
- [ ] HN front page for 4+ hours

### Outstanding Success (Week 1)

- [ ] 500+ npm downloads
- [ ] 300+ GitHub stars
- [ ] 50+ issues/discussions
- [ ] HN #1 or top 3
- [ ] Featured in newsletter/blog

---

## Emergency Response Plan

### If Critical Bug Found

1. **Acknowledge immediately:**
   ```markdown
   Thanks for reporting! This is critical. Working on a fix now.
   ```

2. **Fix and test:**
   ```bash
   # Fix the bug
   npm run test
   npm version patch  # 0.7.7 → 0.7.8
   npm publish --access public
   ```

3. **Update issue:**
   ```markdown
   Fixed in v0.7.8. Please upgrade:
   npm install -g agents-standard@latest
   ```

4. **Post update on HN/Reddit:**
   ```markdown
   Update: Critical bug fixed in v0.7.8 (released 2 hours ago).
   ```

### If Negative Feedback

- **Stay professional and helpful**
- **Acknowledge valid criticism**
- **Ask clarifying questions**
- **Don't argue or get defensive**

Example response:
```markdown
Thanks for the feedback! You're right that [issue] is a limitation.
I'm working on [solution]. Would [alternative approach] address your concern?
```

---

## Next Release Planning

### v0.8.0 (Target: 2 weeks)

Based on expected feedback:

- [ ] Modular project memory (from roadmap)
- [ ] Skills marketplace integration
- [ ] Migration toolkit
- [ ] Top 3 feature requests from launch

### v0.9.0 (Target: 1 month)

- [ ] VSCode extension (GUI)
- [ ] Team config sync
- [ ] Enterprise features (if demand exists)

---

## Resources

- **Launch Templates:** `docs/SHOW_HN.md`
- **Quick Start:** `docs/QUICK_START.md`
- **Examples:** `docs/EXAMPLES.md`
- **Publishing Guide:** `docs/PUBLISHING.md`

---

## Final Pre-Launch Command

```bash
# One last check before npm publish
npm run build && \
npm run test && \
npm run lint && \
npm pack --dry-run && \
echo "✅ All checks passed! Ready to publish."
```

If all green → `npm publish --access public` 🚀

---

**Good luck! 🎉**

Remember: Launch is just the beginning. The real work is listening to users and iterating based on feedback.
