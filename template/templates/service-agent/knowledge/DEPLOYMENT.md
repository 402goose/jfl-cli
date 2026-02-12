# {SERVICE_NAME} - Deployment Guide

## Deployment Target

**Platform:** {Vercel, Fly.io, local, etc.}
**Environment:** {production, staging, development}
**URL:** {production URL if applicable}

## Prerequisites

- [ ] {Prerequisite 1}
- [ ] {Prerequisite 2}
- [ ] Access credentials configured
- [ ] Environment variables set

## Deployment Commands

### Deploy to Production

```bash
{deployment command}
```

### Deploy to Staging

```bash
{staging deployment command if different}
```

### Rollback

```bash
{rollback command}
```

## Environment Variables

Configure these before deploying:

```bash
# Required
export {VAR1}="..."
export {VAR2}="..."

# Optional
export {VAR3}="..."
```

**Where to set:**
- Production: {where env vars are configured}
- Staging: {where env vars are configured}
- Development: `.env.local`

## Pre-Deployment Checklist

- [ ] Tests passing: `{test command}`
- [ ] Build succeeds: `{build command}`
- [ ] Environment variables verified
- [ ] Dependencies up to date
- [ ] Breaking changes documented
- [ ] Database migrations applied (if applicable)

## Post-Deployment Verification

```bash
# Health check
curl {health-check-url}

# Smoke test
{smoke test commands}
```

## Service Control

### Start Service

```bash
{start command}
```

### Stop Service

```bash
{stop command}
```

### Restart Service

```bash
{restart command}
```

### Check Status

```bash
{status check command}
```

### View Logs

```bash
{log command}
```

## Monitoring

**Health Check URL:** {URL or method}
**Logs:** {where logs are}
**Metrics:** {where metrics are tracked}

## Troubleshooting

### Service Won't Start

1. Check logs: `{log command}`
2. Verify environment variables
3. Check port availability
4. Verify dependencies installed

### Deployment Failed

1. Check deployment logs
2. Verify credentials
3. Check for build errors
4. Verify platform status

### Performance Issues

1. Check resource usage
2. Review recent changes
3. Check dependency services
4. Review logs for errors

## Rollback Procedure

If deployment causes issues:

```bash
# 1. Rollback deployment
{rollback command}

# 2. Verify rollback succeeded
{verification command}

# 3. Investigate issue
{investigation steps}
```

## Database Migrations (if applicable)

**Run migration:**
```bash
{migration command}
```

**Rollback migration:**
```bash
{migration rollback command}
```

## Secrets Management

**Where secrets are stored:** {secrets location}

**Update secret:**
```bash
{secret update command}
```

## Common Operations

### Update Dependencies

```bash
{dependency update command}
npm audit fix  # or equivalent
{test command}
```

### Clear Cache

```bash
{cache clear command if applicable}
```

### Database Backup (if applicable)

```bash
{backup command}
```

## Emergency Contacts

- **Platform Support:** {contact info}
- **On-Call:** {contact info}

## Last Updated

{date}
