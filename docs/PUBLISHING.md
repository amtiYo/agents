# Publishing Guide

Instructions for publishing `agents-standard` to npm.

## Pre-publish Checklist

### 1. Verify Tests Pass

```bash
npm run build
npm run test
npm run lint
```

All should pass with no errors.

### 2. Check Package Contents

```bash
npm pack --dry-run
```

Verify the package includes:
- ✅ `bin/agents` (CLI entry point)
- ✅ `dist/` (compiled TypeScript)
- ✅ `templates/` (scaffolding templates)
- ✅ `docs/` (documentation)
- ✅ `README.md`
- ✅ `CHANGELOG.md`
- ✅ `LICENSE`

Should NOT include:
- ❌ `src/` (source code)
- ❌ `tests/` (test files)
- ❌ `node_modules/`
- ❌ `.git/`

### 3. Update Version

If this is a new release:

```bash
# Patch (0.7.7 → 0.7.8)
npm version patch

# Minor (0.7.7 → 0.8.0)
npm version minor

# Major (0.7.7 → 1.0.0)
npm version major
```

This updates `package.json` and creates a git tag.

### 4. Update CHANGELOG.md

Add new version section:

```markdown
## [0.7.8] - 2026-02-08

### Added
- New feature X

### Changed
- Improved Y

### Fixed
- Bug Z
```

Commit:

```bash
git add CHANGELOG.md package.json
git commit -m "release: prepare v0.7.8"
```

## Publishing to npm

### First-Time Setup

1. **Create npm account** (if you don't have one):
   - Go to https://www.npmjs.com/signup

2. **Login to npm CLI**:
   ```bash
   npm login
   ```

3. **Verify login**:
   ```bash
   npm whoami
   ```

### Publish

```bash
# Dry-run first (recommended)
npm publish --dry-run

# If everything looks good, publish for real
npm publish --access public
```

**Expected output:**

```
npm notice
npm notice 📦  agents-standard@0.7.7
npm notice === Tarball Contents ===
npm notice 12.0kB README.md
npm notice 11.1kB CHANGELOG.md
...
npm notice === Tarball Details ===
npm notice name:          agents-standard
npm notice version:       0.7.7
npm notice package size:  XX.X kB
npm notice unpacked size: XXX.X kB
npm notice total files:   XX
npm notice
+ agents-standard@0.7.7
```

### Verify Publication

1. **Check npm registry**:
   ```bash
   npm view agents-standard
   ```

2. **Test installation**:
   ```bash
   # In a different directory
   npm install -g agents-standard@latest
   agents --version
   ```

3. **Test basic functionality**:
   ```bash
   cd /tmp
   mkdir test-agents
   cd test-agents
   agents init
   agents status
   ```

## Post-publish Tasks

### 1. Tag and Push to GitHub

```bash
git tag v0.7.7
git push origin main
git push origin v0.7.7
```

### 2. Create GitHub Release

Go to https://github.com/amtiYo/agents/releases/new

- **Tag**: `v0.7.7`
- **Title**: `v0.7.7`
- **Body**: Copy from CHANGELOG.md

Click "Publish release".

### 3. Update Badge in README

Verify the npm version badge works:

```markdown
[![npm version](https://img.shields.io/npm/v/agents-standard.svg)](https://www.npmjs.com/package/agents-standard)
```

Should show the new version.

### 4. Announce

- [ ] Post on [Hacker News](https://news.ycombinator.com/submit)
- [ ] Tweet/post on X
- [ ] Reddit: r/programming, r/MachineLearning
- [ ] Discord/Slack communities

## Troubleshooting

### "You do not have permission to publish"

- Verify you're logged in: `npm whoami`
- Check package name isn't taken: `npm view agents-standard`
- Use a different name or scoped package: `@yourusername/agents`

### "Version already exists"

```bash
# Bump version
npm version patch

# Try again
npm publish --access public
```

### "prepack script failed"

```bash
# Check TypeScript compilation
npm run build

# Fix any errors, then retry
npm publish --access public
```

### "Package size too large"

Check what's included:

```bash
npm pack --dry-run
```

Update `.npmignore` or `package.json` `files` field to exclude large files.

## Versioning Strategy

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.7.7 → 0.7.8): Bug fixes, no API changes
- **Minor** (0.7.7 → 0.8.0): New features, backward compatible
- **Major** (0.7.7 → 1.0.0): Breaking changes

**Examples:**

```bash
# Bug fix: sync race condition
npm version patch  # → 0.7.8

# New feature: Skills marketplace integration
npm version minor  # → 0.8.0

# Breaking change: rename commands
npm version major  # → 1.0.0
```

## Deprecating Old Versions

If you need to deprecate:

```bash
npm deprecate agents-standard@0.7.6 "Security vulnerability, please upgrade to 0.7.7+"
```

## Unpublishing (Emergency Only)

⚠️ **Use with extreme caution!** Unpublishing breaks downstream users.

```bash
# Unpublish specific version (within 72 hours of publish)
npm unpublish agents-standard@0.7.7

# Unpublish all versions (only if no one is using it)
npm unpublish agents-standard --force
```

**Alternatives to unpublishing:**
1. Publish a patch fix immediately
2. Deprecate the broken version
3. Update README with urgent notice

## Automated Publishing (Future)

### GitHub Actions Workflow

`.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Setup:**
1. Generate npm token: https://www.npmjs.com/settings/[username]/tokens
2. Add to GitHub secrets: `NPM_TOKEN`
3. Create GitHub release → auto-publishes to npm

---

**Questions?** Open an issue or discussion on [GitHub](https://github.com/amtiYo/agents).
