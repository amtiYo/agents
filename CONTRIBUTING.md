# Contributing

Thanks for your interest! Here's how to help.

## Ways to Contribute

| Type | Action |
|:-----|:-------|
| 🐛 **Bug** | [Open an issue](https://github.com/amtiYo/agents/issues) with steps to reproduce |
| 💡 **Feature** | [Start a discussion](https://github.com/amtiYo/agents/discussions) to propose it |
| 📖 **Docs** | Fix typos or add examples via PR |
| 💻 **Code** | Follow the workflow below |

## Development Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/agents.git
cd agents

# Install
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Link locally
npm link
```

## Pull Request Workflow

### 1. Create a branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 2. Make changes

- Write code
- Add tests (required for new features)
- Update docs if needed

### 3. Test

```bash
npm run build
npm test
npm run lint
```

All must pass.

### 4. Commit

```bash
git add .
git commit -m "feat: add new feature"
```

**Commit types:**
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation
- `test:` — Tests
- `refactor:` — Code refactoring
- `chore:` — Maintenance

### 5. Push and create PR

```bash
git push origin feature/your-feature-name
```

Then open a PR on GitHub.

## PR Guidelines

### Title
Clear and concise (e.g., "Add Cursor integration")

### Description
Explain:
- What problem does it solve?
- How does it work?
- Any breaking changes?

### Tests
All PRs must include tests:
- Unit tests for new functions
- Integration tests for commands
- Update existing tests if behavior changes

### Documentation
Update docs if needed:
- README for user-facing changes
- Code comments for complex logic
- CHANGELOG.md (maintainers will handle)

## Code Style

- TypeScript strict mode
- Follow existing patterns
- ESLint rules
- Clear variable names
- Comments for non-obvious code

## Testing

### Run tests

```bash
# All tests
npm test

# Specific file
npm test tests/mcp-commands.integration.test.ts

# Watch mode
npm test -- --watch
```

### Write tests

```typescript
import { describe, it, expect } from 'vitest'

describe('yourFunction', () => {
  it('should do something', () => {
    const result = yourFunction('input')
    expect(result).toBe('expected')
  })
})
```

## Priority Areas

| Priority | Area |
|:---------|:-----|
| 🔴 High | Bug fixes, test coverage, performance, documentation |
| 🟡 Medium | New tool integrations, MCP enhancements, UX improvements |
| 🟢 Nice-to-have | VSCode extension, team features, enterprise features |

## Security

Found a vulnerability? **Email us instead of opening a public issue.**

## Getting Help

- 💬 [GitHub Discussions](https://github.com/amtiYo/agents/discussions)
- 🐛 [GitHub Issues](https://github.com/amtiYo/agents/issues)

## License

By contributing, you agree your contributions are licensed under the Apache License 2.0.
