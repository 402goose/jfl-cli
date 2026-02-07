# Service Migration Guide

## Overview

JFL GTM workspaces should use the **service manager** for managing service dependencies, not git submodules in `references/`.

The `references/` directory should **only** contain reference material (docs, examples, inspiration) and should be gitignored.

## Why Migrate?

**Before (references/ with services):**
```
my-gtm/
├── references/
│   ├── my-service/          ← Service code (submodule)
│   ├── another-service/     ← Another service (submodule)
│   └── some-docs.md         ← Reference material
└── CLAUDE.md
```

**Problems:**
- Services mixed with reference material
- Git submodules are clunky to manage
- References/ gets committed to git
- Hard to update services
- Unclear what's a dependency vs reference

**After (service manager):**
```
my-gtm/
├── .jfl/
│   └── services/
│       ├── my-service/       ← Managed by service manager
│       └── another-service/  ← Managed by service manager
├── references/               ← Gitignored, reference material only
│   └── some-docs.md
└── CLAUDE.md
```

**Benefits:**
- Clean separation: services vs references
- Service manager handles updates/versions
- references/ stays local (gitignored)
- Services tracked in JFL config, not git
- Easy to update: `jfl service update <name>`

## Migration Steps

### 1. Run Migration Command

From your GTM workspace:

```bash
jfl migrate-services
```

Or specify a path:

```bash
jfl migrate-services /path/to/my-gtm
```

### What It Does:

1. **Finds services** in `references/` (directories with `.git`)
2. **Registers each service** with the service manager
3. **Removes service** from `references/`
4. **Updates CLAUDE.md** with service manager instructions
5. **Updates .gitignore** to ignore `references/`

### 2. Review Changes

Check what was migrated:

```bash
jfl service list
```

Review CLAUDE.md:
- New "Service Manager" section added
- Instructions for using services

### 3. Test Service Access

Get a service:

```bash
jfl service get my-service
# Service cloned to .jfl/services/my-service/
```

Update a service:

```bash
jfl service update my-service
```

### 4. Commit Changes

```bash
git add .
git commit -m "feat: migrate to service manager, gitignore references/"
git push
```

## Using references/ Going Forward

### DO:
- ✓ Put docs, examples, inspiration in `references/`
- ✓ Screenshot a competitor's UI → save to `references/competitor-ui.png`
- ✓ Copy a great README pattern → save to `references/readme-example.md`
- ✓ Download a design system guide → save to `references/design-system.pdf`

### DON'T:
- ✗ Clone service repos into `references/`
- ✗ Put dependencies in `references/`
- ✗ Commit `references/` to git

## Service Manager Commands

```bash
# List all services
jfl service list

# Get service code
jfl service get <service-name>
# → Cloned to .jfl/services/<service-name>/

# Update service
jfl service update <service-name>

# Add new service
jfl service add <name> <git-url>

# Remove service
jfl service remove <service-name>
```

## Manual Migration

If you prefer to migrate manually:

1. **For each service in references/:**

```bash
cd references/my-service
git remote get-url origin  # Get the URL

cd ../..
jfl service add my-service <git-url>
rm -rf references/my-service
```

2. **Update .gitignore:**

```bash
echo "references/" >> .gitignore
```

3. **Update CLAUDE.md:**

Add a "Service Manager" section explaining how to use `jfl service` commands.

## Example CLAUDE.md Section

```markdown
## Service Manager

Services are managed via the JFL service manager, not as submodules in references/.

### Available Services

List services:
\`\`\`bash
jfl service list
\`\`\`

Get service code:
\`\`\`bash
jfl service get <service-name>
# Code is cloned to .jfl/services/<service-name>/
\`\`\`

Update service:
\`\`\`bash
jfl service update <service-name>
\`\`\`

### References Directory

The \`references/\` directory is for reference material only (docs, examples, inspiration).
**DO NOT** put service code or dependencies in references/.
```

## Troubleshooting

**Migration failed for a service:**
- Manually register: `jfl service add <name> <git-url>`
- Manually remove: `rm -rf references/<name>`

**Service manager not working:**
- Check config: `cat .jfl/config.json`
- Ensure `services` array exists
- Run `jfl status` to see if services are tracked

**Want to keep some services in references/:**
- Not recommended - defeats the purpose
- If you must: exclude them from gitignore: `!references/special-case/`
