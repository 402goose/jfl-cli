# JFL CLI - Deployment

## Publishing to npm

JFL is published as the `jfl` package on npm: https://www.npmjs.com/package/jfl

### Prerequisites

- Node.js >= 18
- npm account with publish access to the `jfl` package
- Clean working tree (no uncommitted changes)
- All tests passing

### Pre-Publish Checklist

1. **Update version in `package.json`**
   ```bash
   # Patch release (0.1.1 -> 0.1.2)
   npm version patch

   # Minor release (0.1.1 -> 0.2.0)
   npm version minor

   # Major release (0.1.1 -> 1.0.0)
   npm version major
   ```
   This auto-updates `package.json` and creates a git tag.

2. **Update version in `src/index.ts`**
   The `.version()` call on the commander program must match `package.json`. Search for:
   ```typescript
   .version("0.1.1")
   ```

3. **Verify the build compiles cleanly**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Verify npm package contents**
   Check what will be published (respects `.npmignore`):
   ```bash
   npm pack --dry-run
   ```
   Should include:
   - `dist/` (compiled JS, declarations, source maps)
   - `scripts/` (session management, postinstall)
   - `template/` (GTM workspace template with CLAUDE.md, skills, settings)
   - `clawdbot-skill/` (Clawdbot integration)
   - `README.md`
   - `LICENSE`

   Should NOT include:
   - `src/` (TypeScript source)
   - `node_modules/`
   - `.env*`
   - `tsconfig.json`
   - `test*` files
   - `knowledge/` (this directory)

6. **Test locally with npm link**
   ```bash
   npm link
   jfl --version   # Should show new version
   jfl help        # Verify commands work
   jfl init test-project  # Test init flow
   ```

### Publishing

The `prepublishOnly` script in package.json automatically runs `npm run build` before publishing.

```bash
# Publish to npm
npm publish

# If first time or scoped package:
npm publish --access public
```

### Post-Publish Checklist

1. **Verify the published package**
   ```bash
   npm view jfl version
   npm view jfl dist-tags
   ```

2. **Test global install**
   ```bash
   npm install -g jfl
   jfl --version
   ```

3. **Verify auto-update detection**
   Users running `jfl` will auto-detect the new version within 24 hours (or immediately if their cache has expired).

4. **Tag the release in git**
   ```bash
   git push origin main --tags
   ```

5. **Update template repo if needed**
   If CLAUDE.md, skills, or settings changed, push updates to the template repo:
   https://github.com/402goose/jfl-template

## Versioning Strategy

JFL follows semantic versioning:

- **Patch (0.1.x):** Bug fixes, minor improvements. Auto-updated by `jfl update`.
- **Minor (0.x.0):** New commands, new features. Auto-updated by `jfl update`.
- **Major (x.0.0):** Breaking changes. Users are prompted before auto-update.

The auto-update system (`src/commands/update.ts`) checks npm registry against the installed version. The check is cached for 24 hours at `~/.cache/jfl/last-update-check`.

## Template Repo

The GTM workspace template lives at: https://github.com/402goose/jfl-template

When users run `jfl init`, the CLI clones this repo and copies the `template/` folder contents. When users run `jfl update`, the CLI syncs specific paths from this repo.

### What's in the Template Repo

The template repo should contain a `template/` directory that mirrors the GTM workspace structure:

```
template/
├── CLAUDE.md                # AI instructions
├── .claude/
│   ├── settings.json        # Claude Code hooks and settings
│   ├── service-settings.json
│   └── skills/              # All bundled skills
├── .jfl/
│   └── config.json          # Default project config
├── .mcp.json                # MCP server config
├── knowledge/               # Empty knowledge templates
├── content/
├── previews/
├── suggestions/
├── scripts/                 # Session management scripts
└── templates/               # Doc templates
```

### Updating the Template

When making changes to CLAUDE.md, skills, or settings:

1. Make changes in the jfl-cli repo's `template/` directory
2. Test with `jfl init` locally
3. Push changes to jfl-cli repo
4. Push the same changes to the jfl-template repo
5. Users get the updates via `jfl update`

## Rollback

### Unpublish (within 72 hours)

```bash
# Unpublish a specific version (only within 72 hours of publish)
npm unpublish jfl@0.1.2
```

### Deprecate

```bash
# Mark a version as deprecated (users get warning on install)
npm deprecate jfl@0.1.2 "Critical bug, please upgrade to 0.1.3"

# Remove deprecation
npm deprecate jfl@0.1.2 ""
```

### Publish a Fix

If a bad version is released:

1. Fix the issue
2. Bump to next patch version
3. Publish the fix
4. Deprecate the bad version
5. Users auto-update within 24 hours

### Downgrade Instructions for Users

```bash
# Install specific version
npm install -g jfl@0.1.1

# Skip auto-update
jfl --no-update
```

## CI/CD

Currently there is no automated CI/CD pipeline. Publishing is done manually. A future setup could include:

- GitHub Actions for running tests on push
- Automated npm publish on git tag
- Release notes generation from journal entries

## Postinstall Script

When users install JFL globally, `scripts/postinstall.js` runs automatically:

1. Checks if Bun runtime is installed
2. If Bun is available, installs `ralph-tui` globally via `bun install -g ralph-tui`
3. Checks if Clawdbot is installed and shows integration instructions
4. If Bun is not available, shows installation instructions and continues (ralph-tui is optional)

## Service Updates

When the CLI version changes, service-related components may need updates:

- The CLI tracks its version in `.jfl/cli-version` within each project
- `src/lib/service-utils.ts` provides `detectServiceChanges()` and `restartCoreServices()` to handle version-triggered restarts of Context Hub and Service Manager
- `validateCoreServices()` checks if running services match the expected CLI version
