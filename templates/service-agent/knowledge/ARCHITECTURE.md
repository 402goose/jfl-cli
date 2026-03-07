# {SERVICE_NAME} - Architecture

## Tech Stack

**Framework:** {framework}
**Language:** {language}
**Runtime:** {runtime}
**Database:** {database if applicable}
**Key Libraries:**
- {library 1}: {purpose}
- {library 2}: {purpose}

## Directory Structure

```
{SERVICE_NAME}/
├── src/                  # Source code
│   ├── components/       # (if applicable)
│   ├── lib/              # Utilities
│   ├── api/              # API routes
│   └── ...
├── public/               # Static assets (if web)
├── tests/                # Test files
├── .jfl/                 # JFL service agent files
├── knowledge/            # Service documentation
└── package.json          # Dependencies
```

## Key Components

### {Component 1}
- **Purpose:** What it does
- **Location:** `src/path/to/component`
- **Dependencies:** What it depends on
- **Used By:** What uses it

### {Component 2}
- **Purpose:** What it does
- **Location:** `src/path/to/component`
- **Dependencies:** What it depends on
- **Used By:** What uses it

## Data Flow

```
{Describe how data flows through the service}

User Request
    ↓
{Component A}
    ↓
{Component B}
    ↓
Response
```

## Configuration

**Environment Variables:**
| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| {VAR_NAME} | ... | ... | Yes/No |

**Config Files:**
- `{config-file}`: {purpose}

## Build & Development

**Install dependencies:**
```bash
{install command}
```

**Development mode:**
```bash
{dev command}
```

**Build:**
```bash
{build command}
```

**Test:**
```bash
{test command}
```

## Integration Points

### With {Other Service}
- **Purpose:** Why we integrate
- **Method:** HTTP API, event bus, shared DB, etc.
- **Data Exchanged:** What data flows between services

## Patterns & Conventions

- **Code Style:** {linter, formatter}
- **Naming:** {conventions}
- **Error Handling:** {approach}
- **Logging:** {approach}

## Known Issues

- {Issue 1}: {workaround if any}
- {Issue 2}: {workaround if any}

## Future Improvements

- {Improvement 1}
- {Improvement 2}

## Last Updated

{date}
