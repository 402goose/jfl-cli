# {SERVICE_NAME} - Service Specification

**Type:** {SERVICE_TYPE}
**Status:** EMERGENT (update as service evolves)

## Purpose

{1-2 sentence description of what this service does}

## Core Responsibilities

- {Responsibility 1}
- {Responsibility 2}
- {Responsibility 3}

## Public Interface

### Endpoints (if API)
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/... | ... |

### Pages (if Web)
| Route | Purpose |
|-------|---------|
| / | ... |

### Commands (if CLI)
| Command | Purpose |
|---------|---------|
| service command | ... |

## Dependencies

### Upstream Services
| Service | Purpose | Status Check |
|---------|---------|--------------|
| {service-name} | Why we need it | How to verify it's available |

### External APIs
| API | Purpose | Credentials |
|-----|---------|-------------|
| {api-name} | Why we need it | Where creds are stored |

## Data Owned

- {Data type 1}: Where stored, schema
- {Data type 2}: Where stored, schema

## Performance Requirements

- Response time: {target}
- Availability: {target}
- Throughput: {target}

## Security

- Authentication: {method}
- Authorization: {method}
- Secrets: {where stored}

## Monitoring

- Health check: {endpoint or method}
- Key metrics: {list metrics to track}
- Logs: {where logs go}

## Status

**Last Updated:** {date}
**Current Version:** {version}
**Stability:** experimental|stable|production

## Open Questions

- {Question 1}
- {Question 2}
