# AGENTS.md

Instructions for AI coding agents working on the `@agents-dev/cli` project.

## Project Overview

**@agents-dev/cli** is a CLI tool that provides a practical standard layer for multi-LLM development. It solves the configuration fragmentation problem by syncing MCP servers, skills, and instructions across multiple AI coding tools (Codex, Claude Code, Gemini CLI, Cursor, Copilot, Antigravity) from a single source of truth.

**Key Principle:** One `.agents/` folder syncs to all tools. Add an MCP server once, it appears everywhere.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+
- **Build:** tsc (TypeScript compiler)
- **Tests:** Vitest
- **CLI Framework:** Commander.js
- **Prompts:** @clack/prompts
- **Package Manager:** npm

## Project Structure

```
agents/
├── src/
│   ├── cli.ts                    # CLI entry point
│   ├── commands/                 # Command implementations
│   │   ├── start.ts             # Setup wizard
│   │   ├── sync.ts              # Config sync
│   │   ├── mcp-add.ts           # Add MCP server
│   │   └── ...
│   ├── core/                     # Core logic
│   │   ├── sync.ts              # Sync orchestration
│   │   ├── mcp.ts               # MCP management
│   │   ├── renderers.ts         # Tool-specific config generators
│   │   ├── trust.ts             # Codex trust management
│   │   ├── ui.ts                # CLI output helpers (colors, spinners)
│   │   └── ...
│   ├── integrations/             # Tool integrations
│   │   ├── codex.ts
│   │   ├── claude.ts
│   │   ├── cursor.ts
│   │   └── ...
│   └── types.ts                  # TypeScript types
├── tests/                        # Test files
│   ├── *.test.ts                # Unit tests
│   └── *.integration.test.ts    # Integration tests
├── templates/                    # Scaffold templates
│   └── agents/                  # .agents/ directory templates
├── docs/                         # Public documentation
└── bin/agents                    # CLI wrapper script
```

## Development Workflow

### Setup

```bash
npm install
npm run build
npm link
```

### Development Commands

```bash
npm run dev -- <command>          # Run CLI in dev mode
npm run build                     # Compile TypeScript
npm test                          # Run all tests
npm test tests/sync.test.ts       # Run specific test
npm test -- --watch               # Watch mode
npm run lint                      # Run ESLint
```

### Testing

- **Unit tests:** Test individual functions in isolation
- **Integration tests:** Test full command flows with temp directories
- Use `mkdtemp` for temporary test directories
- Always clean up in `afterEach` hooks
- Mock external CLI calls when appropriate

### Code Style

- **TypeScript strict mode** is enabled
- Follow existing patterns and conventions
- Use descriptive variable names
- Add JSDoc comments for exported functions
- Keep functions focused (single responsibility)
- Prefer pure functions where possible

## Key Concepts

### 1. Project Structure (`core/project.ts`)

Projects have:
- `.agents/agents.json` — MCP servers, shared config
- `.agents/local.json` — Secrets (gitignored)
- `.agents/skills/` — Reusable workflows
- `.agents/generated/` — Auto-generated files (gitignored)
- `AGENTS.md` — Instructions for all tools

### 2. Sync Process (`core/sync.ts`)

1. Read `.agents/agents.json` and `.agents/local.json`
2. Merge configs (local overrides shared)
3. Generate tool-specific configs via renderers
4. Write atomically (temp file + rename)
5. Acquire sync lock to prevent race conditions

### 3. Renderers (`core/renderers.ts`)

Each tool has a renderer that converts `.agents/agents.json` to tool-specific format:
- **Codex:** TOML (`.codex/config.toml`)
- **Claude:** JSON (`.claude/mcp.json`)
- **Gemini:** JSON (`.gemini/settings.json`)
- **Cursor:** JSON (`.cursor/mcp.json`)
- **Copilot:** JSON (`.vscode/mcp.json`)
- **Antigravity:** JSON (`.antigravity/mcp.json`)

### 4. MCP Server Management (`core/mcp.ts`)

MCP servers have:
- **Transport:** `stdio` (command-based) or `http`/`sse` (URL-based)
- **Config:** command, args, env, headers
- **Secrets:** Stored in `.agents/local.json`
- **Validation:** Keys must be shell-safe (env) or HTTP token format (headers)

### 5. Trust Management (`core/trust.ts`)

Codex requires explicit trust per project. We:
- Check trust state via `codex trust list`
- Set trust via `codex trust set --path <project>`
- Store trust in Codex global config

### 6. File Safety (`core/fs.ts`)

Critical operations use atomic writes:
- Write to temp file
- Rename to target (atomic on most filesystems)
- Prevents data corruption if process crashes

## Common Tasks

### Adding a New Command

1. Create `src/commands/your-command.ts`
2. Export async function matching command signature
3. Register in `src/cli.ts` with Commander
4. Add tests in `tests/your-command.test.ts`
5. Update README.md command reference
6. Update CHANGELOG.md

### Adding a New Tool Integration

1. Create `src/integrations/your-tool.ts`
2. Implement integration interface (id, name, paths)
3. Add renderer in `src/core/renderers.ts`
4. Register in `src/integrations/registry.ts`
5. Add sync logic in `src/core/sync.ts`
6. Add tests
7. Update README supported tools table

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify test passes
4. Add edge case tests
5. Update CHANGELOG.md (## Unreleased > ### Fixed)

### Adding a Feature

1. Discuss in GitHub issue first (if major)
2. Write tests for new behavior
3. Implement feature
4. Update documentation
5. Update CHANGELOG.md (## Unreleased > ### Added)

## Important Patterns

### Error Handling

```typescript
// Throw descriptive errors
throw new Error(`MCP server "${name}" not found in .agents/agents.json`)

// User-facing errors should be clear and actionable
console.error(`Error: Invalid env key "${key}". Use format: [A-Za-z_][A-Za-z0-9_]*`)
process.exitCode = 1
```

### File Operations

```typescript
// Always use atomic writes for critical files
import { writeJsonAtomic } from './core/fs.js'

await writeJsonAtomic(path, data)
```

### External CLI Calls

```typescript
// Use spawnSync for external commands
import { spawnSync } from 'node:child_process'

const result = spawnSync('codex', ['trust', 'list'], {
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe']
})

if (result.status !== 0) {
  // Handle error
}
```

### CLI Output (UI Module)

Use `src/core/ui.ts` for all user-facing output:

```typescript
import { ui } from './core/ui.js'

// Status messages
ui.success('Config synced')
ui.error('Failed to connect')
ui.warning('Server not responding')
ui.info('Checking configuration...')

// Formatted output
ui.keyValue('Status', 'connected')
ui.list(['item1', 'item2'])
ui.section('MCP Servers')
ui.hint('Run `agents sync` to apply changes')

// Spinners for async operations
const result = await ui.spin('Syncing...', async () => {
  return await doAsyncWork()
})

// Context-aware (respects --json, --quiet, NO_COLOR)
ui.json(data)  // Only outputs if --json flag is set
```

**Rules:**
- Never use raw `console.log()` for user-facing output
- Use `ui.spin()` for any operation > 500ms
- Colors are minimal: green (success), red (error), yellow (warning), cyan (info)
- Unicode symbols have ASCII fallbacks for non-Unicode terminals

### Temp Directories in Tests

```typescript
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('my test', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('does something', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agents-test-'))
    tempDirs.push(dir)
    // test logic
  })
})
```

## Testing Guidelines

### What to Test

- ✅ All public functions
- ✅ Error conditions
- ✅ Edge cases (empty arrays, null values, etc.)
- ✅ Integration flows (full command execution)
- ✅ File I/O (read/write operations)
- ❌ Don't test third-party libraries

### Test Structure

```typescript
describe('feature', () => {
  it('should do X when Y', () => {
    // Arrange
    const input = { ... }

    // Act
    const result = myFunction(input)

    // Assert
    expect(result).toBe(expected)
  })
})
```

### Flaky Tests

If a test is flaky (timing-dependent):
- Increase timeout: `it('test', { timeout: 10000 }, async () => { ... })`
- Add retry logic if appropriate
- Mock external dependencies that cause flakiness

## Release Process

(For maintainers only - see `.docs-internal/PUBLISHING.md`)

1. Update CHANGELOG.md
2. Bump version: `npm version patch|minor|major`
3. Build and test: `npm run build && npm test`
4. Publish: `npm publish --access public`
5. Create GitHub release with tag

## Common Pitfalls

### 1. Forgetting Atomic Writes

**Wrong:**
```typescript
await writeFile(path, JSON.stringify(data))
```

**Right:**
```typescript
await writeJsonAtomic(path, data)
```

### 2. Not Cleaning Up Temp Dirs in Tests

Always use `afterEach` to clean up, or tests will leave garbage in `/tmp`.

### 3. Hardcoding Paths

**Wrong:**
```typescript
const codexConfig = '/Users/me/.codex/config.toml'
```

**Right:**
```typescript
import { getCodexConfigPath } from './core/paths.js'
const codexConfig = getCodexConfigPath()
```

### 4. Not Validating User Input

Always validate:
- MCP server names (no spaces, special chars)
- Env keys (shell-safe format)
- Header keys (HTTP token format)
- File paths (absolute, not relative)

### 5. Assuming External CLIs Are Available

Check if CLI is installed before calling:
```typescript
const result = spawnSync('codex', ['--version'], { encoding: 'utf-8' })
if (result.status !== 0) {
  console.warn('Codex CLI not found. Skipping Codex integration.')
  return
}
```

## Security Considerations

- **Secrets** are stored in `.agents/local.json` (gitignored)
- Never log secrets to console
- Use `--secret-env` and `--secret-header` flags for sensitive values
- Validate all user input (especially paths and shell commands)
- Don't execute arbitrary code from config files

## Performance Tips

- Use `sync --check` for drift detection (faster than full sync)
- Use `status --fast` to skip slow external CLI probes
- Cache external CLI results when appropriate
- Use `Promise.all()` for parallel operations

## Documentation Standards

When updating docs:
- Keep README.md concise (high-level overview)
- Put details in `docs/` files
- Use code examples for clarity
- Include expected output
- Add troubleshooting sections

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/my-feature
```

**Commit Message Format:**
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `test:` — Tests
- `refactor:` — Code refactoring
- `chore:` — Maintenance

## Questions?

- Check existing code for patterns
- Read tests for examples
- Ask in GitHub Discussions
- Open an issue if stuck

## Key Files Reference

- **Entry point:** `src/cli.ts`
- **Sync logic:** `src/core/sync.ts`
- **MCP management:** `src/core/mcp.ts`, `src/core/mcpCrud.ts`
- **Renderers:** `src/core/renderers.ts`
- **Types:** `src/types.ts`
- **File I/O:** `src/core/fs.ts`
- **Paths:** `src/core/paths.ts`
- **UI helpers:** `src/core/ui.ts`

---

**Remember:** The goal is to make multi-LLM development simple. Every feature should reduce friction, not add complexity.
