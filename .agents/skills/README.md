# Skills Folder

This directory stores project skills used across supported LLM tools.

## Included starter skills
- `skill-guide`: how to design and maintain project skills.
- `docs-research`: short workflow for gathering high-signal docs quickly.
- `mcp-troubleshooting`: triage flow for MCP setup and runtime issues.

## Skill structure
Each skill must live in its own folder and contain `SKILL.md`:

```text
.agents/skills/<skill-id>/SKILL.md
```

## Minimal SKILL.md template
```md
---
name: my-skill
description: When this skill should be used.
---

Step-by-step instructions for the agent.
```

Keep skills narrow and reusable. Prefer one clear outcome per skill.

## Recommended conventions
- Directory name should match frontmatter `name`.
- Use kebab-case for `name` (lowercase letters, numbers, `-`).
- Keep `description` specific so tools can trigger the skill correctly.
