# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on
[this repository](https://github.com/amtiYo/agents/security/advisories/new). Please do not
open a public issue for something exploitable.

Include what you ran, what happened, and what you expected. A minimal `.agents/agents.json`
that reproduces it is worth more than a description.

## What this tool does with your files

`agents` reads a project's `.agents/` directory and writes configuration for the tools you
enable. That means it touches files it does not own:

- Project files: `.codex/config.toml`, `.cursor/mcp.json`, `.mcp.json`, `.zed/settings.json`,
  `.kilo/kilo.jsonc`, `.amp/settings.json` and the rest of the table in the README.
- Files in your home directory: `~/.codex/config.toml` (project trust),
  `~/.grok/trusted_folders.toml` (folder trust), `~/.config/goose/config.yaml`,
  `~/.codeium/windsurf/mcp_config.json`, the Claude Desktop configuration.
- Symlinks from a tool's directory to `.agents/skills`.

Every write goes through a temporary file and a rename, keeps the permissions of the file it
replaces, and touches only the entries this CLI wrote before, tracked per file in
`.agents/generated/`. Settings that belong to the tool or to you are left alone.

## What it will not do

- Write a resolved secret into a file it does not add to `.gitignore`, whether the value
  comes from `.agents/local.json` or from the environment. Amp, Zed, Kilo and
  `.github/mcp.json` keep the `${VAR}` placeholder from `agents.json`, and so does every
  generated file in `commit-generated` mode.
- Follow a symlink that leaves the project when it builds the flat skill copy for
  Antigravity. A skill that links outside the project is reported and left out.
- Act on a path or a name recorded in `.agents/generated/` that is not one this CLI writes
  for this project.
- Take over an existing skills directory or symlink it did not create.

## What it does run

`agents mcp budget` and `agents mcp test --runtime` start the MCP servers listed in
`.agents/agents.json` to ask them for their tool list. The commands come from the project's
committed configuration, which in a repository you cloned was written by someone else. They
are started directly, without a shell, but they are still that person's code running as you.
Read `.agents/agents.json` before running either command in a repository you do not trust.

`agents plugin import` adds servers and skills from a package to your project. Nothing runs
during the import, but the servers it adds will start the next time a tool uses them. The
import reports a server whose command is a shell interpreter; read the result in
`.agents/agents.json` before syncing.

## Secrets

`.agents/agents.json` is committed and holds `${VAR}` placeholders. `.agents/local.json` is
gitignored, holds the values, and is written with owner-only permissions. `agents plugin
export` never reads it. `agents doctor` reports literal secrets that ended up in the
committed file.
