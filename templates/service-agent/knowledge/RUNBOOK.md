# {SERVICE_NAME} - Operations Runbook

## Common Tasks

### Task: Update Content/Copy

**When:** Content or messaging needs to change

**Steps:**
1. Locate the component: `{typical location}`
2. Update the content
3. Test locally: `{dev command}`
4. Commit: `git add . && git commit -m "content: update {what}"`
5. Deploy: `{deploy command}`
6. Verify on production

**Example files:**
- Homepage: `{file path}`
- About page: `{file path}`

---

### Task: Add New Feature

**When:** New functionality needed

**Steps:**
1. Review SERVICE_SPEC.md and ARCHITECTURE.md
2. Plan the change (which components affected)
3. Implement the feature
4. Add tests: `{test file location}`
5. Test locally: `{test command}`
6. Update documentation if needed
7. Commit with appropriate type: `feat: {description}`
8. Deploy
9. Write journal entry documenting the feature

---

### Task: Fix Bug

**When:** Something broken

**Steps:**
1. Reproduce the issue locally
2. Check logs for errors: `{log command}`
3. Identify root cause
4. Write test that fails (reproduces bug)
5. Fix the bug
6. Verify test now passes
7. Commit: `fix: {description}`
8. Deploy
9. Journal entry with root cause analysis

---

### Task: Update Dependencies

**When:** Security updates or new features needed

**Steps:**
```bash
# Check for updates
{check updates command}

# Update dependencies
{update command}

# Test everything still works
{test command}

# Check for breaking changes
git diff package.json

# Commit
git commit -m "chore: update dependencies"

# Deploy and monitor
```

---

### Task: Performance Investigation

**When:** Service is slow

**Steps:**
1. Check resource usage: `{resource check command}`
2. Review recent changes: `git log --oneline -10`
3. Check dependency services status
4. Review logs for slow queries/operations
5. Profile if needed: `{profiling command}`
6. Implement fix
7. Verify improvement
8. Document findings in journal

---

## Troubleshooting

### Symptom: Service Won't Start

**Possible Causes:**
- Port already in use
- Missing environment variables
- Dependency service down
- Database connection failed

**Investigation:**
```bash
# Check if port is in use
lsof -i :{PORT}

# Verify environment variables
{env check command}

# Check logs
{log command}

# Verify dependencies
{dependency check}
```

**Resolution:**
1. Kill process using port (if appropriate)
2. Set missing environment variables
3. Restart dependency services
4. Fix configuration issues

---

### Symptom: 500 Errors

**Possible Causes:**
- Uncaught exception
- Database query failed
- External API down
- Invalid configuration

**Investigation:**
```bash
# Check error logs
{error log command}

# Check external service status
curl {dependency-health-check}

# Review recent changes
git log --oneline -5
```

**Resolution:**
1. Fix code issue causing exception
2. Handle database errors gracefully
3. Add fallback for external API
4. Correct configuration

---

### Symptom: Slow Performance

**Possible Causes:**
- Inefficient database queries
- Large payload sizes
- External API latency
- Memory leak

**Investigation:**
```bash
# Check resource usage
{resource command}

# Profile performance
{profile command}

# Check database query times
{db query log}

# Monitor external API calls
{api monitoring}
```

**Resolution:**
1. Optimize database queries (add indexes, reduce joins)
2. Implement caching
3. Reduce payload sizes
4. Add timeouts to external calls
5. Fix memory leaks

---

## Health Checks

### Manual Health Check

```bash
# Check service is responding
curl {health-check-url}

# Expected response:
{expected response}
```

### Automated Monitoring

- **Uptime:** {where uptime is monitored}
- **Error Rate:** {where errors are tracked}
- **Response Time:** {where latency is tracked}

**Alert Thresholds:**
- Error rate > {threshold}%
- Response time > {threshold}ms
- Availability < {threshold}%

---

## Data Operations

### Backup (if applicable)

```bash
{backup command}
```

**Backup schedule:** {schedule}
**Backup location:** {location}

### Restore (if applicable)

```bash
{restore command}
```

### Data Migration

```bash
{migration command}
```

**Migration history:** `{migrations location}`

---

## Security Operations

### Rotate Secrets

```bash
# Update secret in platform
{secret update command}

# Restart service to pick up new secret
{restart command}

# Verify service still works
{health check}
```

### Audit Access

```bash
{access audit command}
```

**Who has access:** {list or command}

### Security Scan

```bash
# Scan dependencies
npm audit  # or equivalent

# Fix vulnerabilities
npm audit fix
```

---

## Scaling (if applicable)

### Scale Up

```bash
{scale up command}
```

### Scale Down

```bash
{scale down command}
```

### Check Current Scale

```bash
{check scale command}
```

---

## Integration Points

### With {Service A}

**Purpose:** {why we integrate}
**Health Check:** `{command to verify integration}`
**Common Issues:**
- {Issue 1}: {fix}
- {Issue 2}: {fix}

### With {Service B}

**Purpose:** {why we integrate}
**Health Check:** `{command to verify integration}`
**Common Issues:**
- {Issue 1}: {fix}
- {Issue 2}: {fix}

---

## Emergency Procedures

### Service Down

1. Check health: `{health check command}`
2. Check logs: `{log command}`
3. Restart: `{restart command}`
4. If still down, rollback: `{rollback command}`
5. Investigate root cause
6. Emit error event to GTM
7. Update status.json to error state

### Data Loss

1. Stop service immediately
2. Assess scope of loss
3. Restore from backup: `{restore command}`
4. Verify data integrity
5. Restart service
6. Document incident in journal

### Security Incident

1. Isolate affected systems
2. Review access logs
3. Rotate credentials: `{rotate command}`
4. Patch vulnerability
5. Deploy fix
6. Monitor for further issues
7. Document incident

---

## Regular Maintenance

### Daily
- [ ] Check error logs: `{log command}`
- [ ] Verify health check passing
- [ ] Review resource usage

### Weekly
- [ ] Review performance metrics
- [ ] Check for dependency updates
- [ ] Review and clear old logs

### Monthly
- [ ] Security audit: `npm audit`
- [ ] Review and update documentation
- [ ] Review and optimize database (if applicable)
- [ ] Test backup/restore procedure

---

## Useful Commands Reference

```bash
# Development
{dev command}

# Build
{build command}

# Test
{test command}

# Deploy
{deploy command}

# Logs
{log command}

# Status
{status command}

# Restart
{restart command}
```

---

## Contact Information

**Service Owner:** {owner}
**Team:** {team name}
**Slack Channel:** {slack channel}
**Documentation:** {doc links}

---

## Last Updated

{date}
