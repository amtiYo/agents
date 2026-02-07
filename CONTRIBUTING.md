# Contributing to agents-standard

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🤝 Ways to Contribute

### 1. Report Issues

Found a bug or have a feature request?

- Search [existing issues](https://github.com/amtiYo/agents/issues) first
- If none exist, [create a new issue](https://github.com/amtiYo/agents/issues/new)
- Use descriptive titles
- Include steps to reproduce (for bugs)
- Include your environment (Node version, OS, tool versions)

**Bug Report Template:**

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Run `agents start`
2. Add MCP server with `agents mcp add ...`
3. See error

**Expected behavior**
What you expected to happen.

**Environment:**
- OS: [e.g., macOS 14.0]
- Node.js: [e.g., v20.10.0]
- agents version: [e.g., 0.7.7]
- Affected tools: [e.g., Cursor, Claude Code]

**Additional context**
Any other relevant information.
```

### 2. Suggest Features

Have an idea for improvement?

- Check [existing discussions](https://github.com/amtiYo/agents/discussions)
- Start a new discussion in "Ideas" category
- Explain the use case
- Describe the proposed solution
- Consider backward compatibility

### 3. Improve Documentation

Documentation contributions are highly valued!

- Fix typos or unclear explanations
- Add examples or use cases
- Improve code comments
- Translate to other languages (future)

### 4. Submit Code

Ready to code? Great!

#### Development Setup

```bash
# Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/agents.git
cd agents

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Link for local testing
npm link
```

#### Development Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes:**
   - Write code
   - Add tests (required for new features)
   - Update documentation if needed

3. **Test your changes:**
   ```bash
   npm run build
   npm test
   npm run lint
   ```

4. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   # or
   git commit -m "fix: resolve bug"
   ```

   **Commit Message Format:**
   - `feat:` — New feature
   - `fix:` — Bug fix
   - `docs:` — Documentation changes
   - `test:` — Test changes
   - `refactor:` — Code refactoring
   - `chore:` — Maintenance tasks

5. **Push and create a pull request:**
   ```bash
   git push origin feature/your-feature-name
   ```

   Then open a PR on GitHub.

#### Pull Request Guidelines

- **Title:** Clear, concise description (e.g., "Add Windsurf integration")
- **Description:** Explain what and why
  - What problem does it solve?
  - How does it work?
  - Breaking changes (if any)?
  - Related issues?

- **Tests:** All PRs must include tests
  - Unit tests for new functions
  - Integration tests for commands
  - Update existing tests if behavior changes

- **Documentation:** Update docs if needed
  - README for user-facing changes
  - Code comments for complex logic
  - CHANGELOG.md for releases (maintainers will handle)

- **Code Style:** Follow existing patterns
  - TypeScript strict mode
  - ESLint rules
  - Clear variable names
  - Add comments for non-obvious code

#### Code Review Process

1. Automated checks run (tests, lint)
2. Maintainer reviews code
3. Address feedback (if any)
4. Approval and merge

We aim to review PRs within 48 hours.

## 🎯 Priority Areas

We're especially interested in contributions for:

### High Priority

- **Bug fixes** — Always welcome
- **Test coverage** — Improve existing tests
- **Performance** — Optimize slow operations
- **Documentation** — Examples, guides, tutorials

### Medium Priority

- **New tool integrations** — Add support for more AI coding tools
- **MCP enhancements** — Improve MCP server management
- **UX improvements** — Better CLI output, error messages

### Future/Nice to Have

- **VSCode extension** — GUI for config management
- **Team features** — Shared configs, remote sync
- **Enterprise features** — SSO, audit logs

## 📋 Testing Guidelines

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test tests/mcp-commands.test.ts

# Watch mode
npm test -- --watch

# Coverage (future)
npm run test:coverage
```

### Writing Tests

We use [Vitest](https://vitest.dev/).

**Example unit test:**

```typescript
import { describe, it, expect } from 'vitest'
import { yourFunction } from '../src/core/yourModule'

describe('yourFunction', () => {
  it('should do something', () => {
    const result = yourFunction('input')
    expect(result).toBe('expected')
  })

  it('should handle edge cases', () => {
    expect(() => yourFunction('')).toThrow()
  })
})
```

**Example integration test:**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { runCommand } from '../src/commands/yourCommand'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('command integration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should run command successfully', async () => {
    await runCommand({ projectRoot: tempDir })
    // assertions
  })
})
```

## 🛡️ Security

Found a security vulnerability?

**DO NOT** open a public issue.

Instead, email: [your-email@example.com]

We'll respond within 48 hours.

## 📜 Code of Conduct

### Our Pledge

We're committed to providing a welcoming and inclusive environment.

### Our Standards

**Positive behavior:**
- Being respectful and empathetic
- Giving and accepting constructive feedback
- Focusing on what's best for the community

**Unacceptable behavior:**
- Harassment, discrimination, or personal attacks
- Trolling or inflammatory comments
- Publishing others' private information

### Enforcement

Violations may result in:
1. Warning
2. Temporary ban
3. Permanent ban

Report issues to: [your-email@example.com]

## 📞 Getting Help

Stuck? We're here to help!

- **Questions:** [GitHub Discussions](https://github.com/amtiYo/agents/discussions)
- **Bugs:** [GitHub Issues](https://github.com/amtiYo/agents/issues)
- **Chat:** [Discord](https://discord.gg/your-invite) (future)

## 🎉 Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes (for significant contributions)
- README acknowledgments (for major features)

Thank you for making `agents-standard` better! 🙏

---

**License:** By contributing, you agree your contributions are licensed under the MIT License.
