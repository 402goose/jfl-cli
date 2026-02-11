# JFL GTM Runtime - OpenClaw Skill

Run your entire GTM workspace from OpenClaw, exactly as you would in Claude Code.

## What This Skill Does

This skill makes OpenClaw behave like Claude Code in a GTM (Go-To-Market) workspace:

- **Reads CLAUDE.md** - Follows the complete instruction set for GTM operation
- **Executes protocols** - Journal entries, context loading, decision capture
- **Accesses JFL tools** - context-hub, crm, synopsis, session management
- **Manages services** - Context Hub, auto-commit, deployments, TUI interfaces
- **Orchestrates agents** - Coordinator spawns service-specific agents (API, Frontend, Docs, etc.)
- **Operates with elevated permissions** - No friction for GTM workflows

**The key insight:** GTM is not a CLI tool—it's a **Claude Code operating protocol** defined in structured markdown.

---

## Frontmatter

```yaml
---
name: jfl-gtm
description: GTM workspace runtime - run go-to-market as Claude Code does
user-invocable: true
metadata:
  requires:
    bins:
      - jfl
      - git
    env:
      - CONTEXT_HUB_URL
  keywords:
    - gtm
    - workspace
    - claude-code
    - context
    - journal
    - product
    - launch
    - agents
    - orchestration
  version: 1.0.0
  author: JFL Team
  homepage: https://github.com/402goose/just-fucking-launch
  emoji: 🚀
  permissions:
    bash: allow
    fileWrite: allow
    fileRead: allow
    network: allow
---
```

---

## 1. Workspace Discovery & Selection

### Auto-Discover GTM Workspaces

```bash
#!/bin/bash
# Find GTM workspaces (have .jfl/ and CLAUDE.md)

discover_gtm_workspaces() {
  local search_paths=(
    ~/code
    ~/Projects
    ~/Documents
    ~/workspace
    ~/dev
  )

  # Also check openclaw.json for configured paths
  local config_file="${HOME}/.openclaw/openclaw.json"
  if [[ -f "$config_file" ]]; then
    local config_paths=$(jq -r '.skills.entries["jfl-gtm"].config.workspace_paths[]?' "$config_file" 2>/dev/null)
    search_paths+=($config_paths)
  fi

  for base_dir in "${search_paths[@]}"; do
    [[ ! -d "$base_dir" ]] && continue

    find "$base_dir" -maxdepth 3 -type d -name ".jfl" 2>/dev/null | while read jfldir; do
      workspace="${jfldir%/.jfl}"

      # Verify it's a GTM workspace
      if [[ -d "$workspace/knowledge" ]] && [[ -f "$workspace/CLAUDE.md" ]]; then
        # Check for recent activity
        last_commit=$(git -C "$workspace" log -1 --format=%ct 2>/dev/null || echo 0)
        age_days=$(( ($(date +%s) - last_commit) / 86400 ))

        # Only show workspaces active in last 6 months
        if [[ $age_days -lt 180 ]]; then
          # Get project name
          name=$(jq -r '.name // empty' "$workspace/.jfl/config.json" 2>/dev/null || basename "$workspace")
          echo "$workspace|$name|$age_days"
        fi
      fi
    done
  done
}

# Present workspaces for selection
echo "🔍 Discovering GTM workspaces..."
workspaces=$(discover_gtm_workspaces | sort -t'|' -k3 -n)  # Sort by activity

if [[ -z "$workspaces" ]]; then
  echo "❌ No GTM workspaces found."
  echo ""
  echo "Create one with: jfl init my-project"
  exit 1
fi

echo ""
echo "Available workspaces:"
echo ""

IFS=$'\n'
workspace_array=($workspaces)
unset IFS

i=1
for ws in "${workspace_array[@]}"; do
  IFS='|' read -r path name age <<< "$ws"
  if [[ $age -eq 0 ]]; then
    age_str="today"
  elif [[ $age -eq 1 ]]; then
    age_str="1 day ago"
  else
    age_str="${age} days ago"
  fi
  echo "  $i. $name ($age_str)"
  i=$((i+1))
done

echo ""
read -p "Select workspace (1-${#workspace_array[@]}): " selection

if [[ ! "$selection" =~ ^[0-9]+$ ]] || [[ $selection -lt 1 ]] || [[ $selection -gt ${#workspace_array[@]} ]]; then
  echo "Invalid selection"
  exit 1
fi

selected_ws="${workspace_array[$((selection-1))]}"
IFS='|' read -r WORKSPACE PROJECT_NAME AGE <<< "$selected_ws"

export WORKSPACE
export PROJECT_NAME

echo ""
echo "✅ Selected: $PROJECT_NAME"
echo "📁 Path: $WORKSPACE"
echo ""
```

### Configuration Override

Check `~/.openclaw/openclaw.json` for:
- `skills.entries["jfl-gtm"].config.workspace_paths` - Custom search paths
- `skills.entries["jfl-gtm"].config.default_workspace` - Auto-select workspace
- `skills.entries["jfl-gtm"].config.auto_start_context_hub` - Start Context Hub automatically
- `skills.entries["jfl-gtm"].env.CONTEXT_HUB_URL` - Context Hub endpoint

---

## 2. Session Initialization (Claude Code Emulation)

### Step 1: Read CLAUDE.md (The Instruction Set)

```bash
cd "$WORKSPACE"

echo "📖 Reading CLAUDE.md..."

if [[ ! -f "CLAUDE.md" ]]; then
  echo "❌ CLAUDE.md not found. This doesn't appear to be a GTM workspace."
  exit 1
fi

# CLAUDE.md contains the complete instruction set for GTM operation
# Everything that follows is guided by it

# Extract key configuration
PROJECT_NAME=$(jq -r '.name // empty' .jfl/config.json 2>/dev/null || basename "$WORKSPACE")
WORKING_BRANCH=$(jq -r '.working_branch // "main"' .jfl/config.json 2>/dev/null)

echo "✅ Loaded GTM instructions"
```

### Step 2: Execute SessionStart Protocol

```bash
echo ""
echo "🚀 Initializing GTM session..."
echo ""

# From CLAUDE.md: "At Session Start - ALWAYS Do"

# 1. Run session sync
echo "1️⃣ Syncing repositories..."
if [[ -f "./scripts/session/session-sync.sh" ]]; then
  ./scripts/session/session-sync.sh 2>&1 | tail -5
  echo "✅ Repos synced"
else
  echo "⚠️  session-sync.sh not found, skipping"
fi

# 2. Run doctor check (ONLY for existing projects)
echo ""
echo "2️⃣ Running health check..."

COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
if [[ "$COMMIT_COUNT" -gt "5" ]]; then
  # Existing project - run doctor
  if [[ -f "./scripts/session/jfl-doctor.sh" ]]; then
    DOCTOR_OUTPUT=$(./scripts/session/jfl-doctor.sh 2>&1)

    if echo "$DOCTOR_OUTPUT" | grep -q "WARNING\|ERROR"; then
      echo "$DOCTOR_OUTPUT"
      echo ""
      read -p "Doctor found issues. Continue anyway? (y/n): " continue_choice
      if [[ "$continue_choice" != "y" ]]; then
        echo "Session aborted. Fix issues with: ./scripts/session/jfl-doctor.sh --fix"
        exit 1
      fi
    else
      echo "✅ Health check passed"
    fi
  fi
else
  # Fresh project
  echo "✅ Fresh project detected, skipping doctor"
fi

# 3. Ensure Context Hub is running
echo ""
echo "3️⃣ Starting Context Hub..."

CONTEXT_HUB_URL="${CONTEXT_HUB_URL:-http://localhost:4242}"

# Check if jfl command exists
if ! command -v jfl &> /dev/null; then
  echo "❌ jfl command not found"
  echo "Install with: npm install -g just-fucking-launch"
  exit 1
fi

# Ensure Context Hub
jfl context-hub ensure

# Wait for health check
echo -n "Waiting for Context Hub... "
timeout 10 bash -c "until curl -sf $CONTEXT_HUB_URL/health &>/dev/null; do sleep 0.5; done" && echo "✅ Running" || {
  echo "❌ Failed"
  echo "Context Hub not responding. Try: jfl context-hub start"
  exit 1
}

export CONTEXT_HUB_URL
```

### Step 3: Load Unified Context

```bash
echo ""
echo "4️⃣ Loading context..."

# Query Context Hub for aggregated context
CONTEXT_RESPONSE=$(curl -s "$CONTEXT_HUB_URL/api/context" 2>/dev/null)

if [[ -z "$CONTEXT_RESPONSE" ]]; then
  echo "⚠️  Context Hub not responding, continuing without context"
else
  # Filter cross-project pollution
  # CRITICAL: Context Hub may return results from OTHER projects

  # Get current project path
  CURRENT_PROJECT=$(pwd)

  # Parse journal entries and verify they match current project
  JOURNAL_ENTRIES=$(echo "$CONTEXT_RESPONSE" | jq -r '.journal[]? | select(.path | startswith("'"$CURRENT_PROJECT"'")) | .title' 2>/dev/null)

  if [[ -n "$JOURNAL_ENTRIES" ]]; then
    echo "✅ Context loaded"
    echo ""
    echo "Recent work:"
    echo "$JOURNAL_ENTRIES" | head -5
  else
    if [[ "$COMMIT_COUNT" -gt "5" ]]; then
      echo "⚠️  No journal entries found for this project"
    else
      echo "✅ Fresh project, no prior context"
    fi
  fi
fi
```

### Step 4: Show Project Dashboard

```bash
echo ""
echo "5️⃣ Loading dashboard..."
echo ""

# Run HUD skill if available, otherwise synthesize manually
if command -v claude &> /dev/null && [[ -f ".claude/skills/hud/SKILL.md" ]]; then
  # Invoke HUD skill
  claude skill hud 2>/dev/null || {
    # Manual synthesis fallback
    echo "📊 $PROJECT_NAME Dashboard"
    echo ""

    # Ship date
    SHIP_DATE=$(grep -E "Ship:|Launch:" knowledge/ROADMAP.md 2>/dev/null | head -1 | sed 's/.*:\s*//' || echo "Not set")
    echo "🚀 Ship Date: $SHIP_DATE"

    # Current phase
    PHASE=$(grep -E "Phase:|Stage:" knowledge/ROADMAP.md 2>/dev/null | head -1 | sed 's/.*:\s*//' || echo "Foundation")
    echo "📍 Phase: $PHASE"

    echo ""

    # Recent synopsis
    if command -v jfl &> /dev/null; then
      echo "Recent work:"
      jfl synopsis 24 2>/dev/null | tail -10 || echo "  (No recent activity)"
    fi
  }
else
  # Manual synthesis
  echo "📊 $PROJECT_NAME Dashboard"
  echo ""

  SHIP_DATE=$(grep -E "Ship:|Launch:" knowledge/ROADMAP.md 2>/dev/null | head -1 | sed 's/.*:\s*//' || echo "Not set")
  echo "🚀 Ship Date: $SHIP_DATE"

  PHASE=$(grep -E "Phase:|Stage:" knowledge/ROADMAP.md 2>/dev/null | head -1 | sed 's/.*:\s*//' || echo "Foundation")
  echo "📍 Phase: $PHASE"

  echo ""
  echo "Recent journal entries:"
  if [[ -d ".jfl/journal" ]]; then
    cat .jfl/journal/*.jsonl 2>/dev/null | jq -r '.title' 2>/dev/null | tail -5 || echo "  (No entries yet)"
  else
    echo "  (No entries yet)"
  fi
fi

echo ""
echo "✅ Session initialized"
echo ""
echo "Ready to work. What's next?"
```

### Step 5: Context Verification

```bash
# CRITICAL check from CLAUDE.md
if [[ -f "./scripts/session/test-context-preservation.sh" ]]; then
  VERIFY_OUTPUT=$(./scripts/session/test-context-preservation.sh 2>&1)

  if echo "$VERIFY_OUTPUT" | grep -q "FAIL"; then
    echo ""
    echo "⚠️  Context integrity check failed:"
    echo "$VERIFY_OUTPUT"
    echo ""
    read -p "Continue anyway? (y/n): " verify_choice
    if [[ "$verify_choice" != "y" ]]; then
      echo "Session aborted"
      exit 1
    fi
  fi
fi
```

---

## 3. Protocol Execution (Following CLAUDE.md)

### Journal Entry Protocol (MANDATORY)

From CLAUDE.md: "Journal protocol is NON-NEGOTIABLE. NOT OPTIONAL. NOT SKIPPABLE."

#### When to Write Journal Entries

**Write immediately after ANY of these events:**

| Trigger | Type | Capture |
|---------|------|---------|
| Feature completed | `feature` | What built, files, what's stubbed, next steps |
| Decision made | `decision` | Options, choice, why, decision slug |
| Bug fixed | `fix` | Root cause, the fix, learned |
| Something learned | `discovery` | Insight, how it changes approach |
| Milestone reached | `milestone` | Everything in milestone, incomplete items |
| Session ending | `session-end` | Summary, handoff for next person |

#### Entry Format

```json
{
  "v": 1,
  "ts": "2026-02-10T12:00:00.000Z",
  "session": "session-USER-YYYYMMDD-HHMM-XXXXX",
  "type": "feature|fix|decision|milestone|discovery|session-end",
  "status": "complete|incomplete|blocked",
  "title": "Short title",
  "summary": "2-3 sentence summary",
  "detail": "Full description with context",
  "files": ["file1.ts", "file2.ts"],
  "decision": "decision-slug",
  "incomplete": ["things not finished"],
  "next": "what should happen next",
  "learned": ["key learnings"]
}
```

#### How to Write

```bash
# Helper function for journal entries
write_journal_entry() {
  local type="$1"
  local title="$2"
  local summary="$3"
  local detail="$4"
  local files="$5"  # JSON array string

  SESSION=$(git -C "$WORKSPACE" branch --show-current 2>/dev/null || echo "openclaw-session")
  JOURNAL_FILE="$WORKSPACE/.jfl/journal/${SESSION}.jsonl"

  mkdir -p "$WORKSPACE/.jfl/journal"

  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  # Build JSON entry
  ENTRY=$(jq -n \
    --arg v "1" \
    --arg ts "$TIMESTAMP" \
    --arg session "$SESSION" \
    --arg type "$type" \
    --arg status "complete" \
    --arg title "$title" \
    --arg summary "$summary" \
    --arg detail "$detail" \
    --argjson files "${files:-[]}" \
    '{
      v: ($v | tonumber),
      ts: $ts,
      session: $session,
      type: $type,
      status: $status,
      title: $title,
      summary: $summary,
      detail: $detail,
      files: $files
    }')

  # Append to journal file
  echo "$ENTRY" >> "$JOURNAL_FILE"

  # Commit journal entry
  cd "$WORKSPACE"
  git add "$JOURNAL_FILE"
  git commit -m "journal: $title" &>/dev/null || true
  git push origin &>/dev/null || true

  echo "✅ Journal entry written: $title"
}

# Export for use in agent scripts
export -f write_journal_entry
```

**Real-time capture (don't wait for session end):**

1. Do the work
2. Commit (if code)
3. **Write journal entry ← MANDATORY**
4. Continue to next task

The Stop hook will BLOCK session end if no journal entry exists.

### Decision Capture Protocol

From CLAUDE.md: "When a decision is made, update docs AND journal IMMEDIATELY."

```bash
# Helper function for decision capture
capture_decision() {
  local doc_file="$1"     # Which knowledge doc to update
  local decision="$2"      # Decision content
  local why="$3"          # Reasoning
  local slug="$4"         # Decision slug for linking

  # Update the doc
  {
    echo ""
    echo "## $(basename "$slug" | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g') ($(date +%Y-%m-%d))"
    echo ""
    echo "**Decision:** $decision"
    echo ""
    echo "**Why:** $why"
    echo ""
  } >> "$WORKSPACE/$doc_file"

  # Write journal entry
  write_journal_entry \
    "decision" \
    "Decision: $slug" \
    "$decision" \
    "Updated $doc_file with decision. Reasoning: $why" \
    "[\"$doc_file\"]"

  # Commit
  cd "$WORKSPACE"
  git add "$doc_file" ".jfl/journal/"*.jsonl
  git commit -m "decision: $slug" &>/dev/null || true
  git push origin &>/dev/null || true

  echo "✅ Decision captured in $doc_file"
}

export -f capture_decision
```

**Example usage:**

```bash
# User decides on pricing model
capture_decision \
  "knowledge/PRICING.md" \
  "Usage-based pricing: \$5/day" \
  "Aligns with x402 micropayments, lower barrier to start, scales with value" \
  "pricing-model-usage-based"
```

### File Header Protocol (@purpose)

From CLAUDE.md: "Every code file MUST have @purpose header."

```typescript
/**
 * Component/Module Name
 *
 * Brief description.
 *
 * @purpose One-line purpose statement
 * @spec Optional: link to spec (e.g., PLATFORM_SPEC.md#section)
 * @decision Optional: decision slug (e.g., journal/2026-01.md#decision-id)
 */
```

**When to add:**
- When creating new .ts/.tsx/.js/.jsx files
- PostToolUse hook will warn if @purpose missing
- Add immediately if warned

**Why:**
- Synopsis can extract context from files
- Codebase understanding without reading full files
- Decision traceability

---

## 4. JFL CLI Tool Access

### Context Hub

```bash
# Ensure running
jfl context-hub ensure

# Check status
jfl context-hub status

# Manual control
jfl context-hub start
jfl context-hub stop

# Health check
curl -s "$CONTEXT_HUB_URL/health"

# Query for context
curl -s "$CONTEXT_HUB_URL/api/context" | jq .
```

### Synopsis (Work Summary)

```bash
# Last 24 hours, all team
jfl synopsis 24

# Last 8 hours
jfl synopsis 8

# Specific author
jfl synopsis 24 username

# Verbose output
jfl synopsis 24 --verbose
```

**Returns:**
- Journal entries aggregated
- Git commits from all branches
- File headers (@purpose, @spec, @decision)
- Time audit with category breakdown
- Health checks

**Use when asked:** "What happened?", "What did X work on?", "Give me a status update"

### CRM CLI

```bash
# Dashboard
cd "$WORKSPACE" && ./crm

# List pipeline
./crm list

# Prep for call (full context)
./crm prep "Contact Name"

# Log activity
./crm touch "Contact Name"

# Update field
./crm update "Contact Name" status HOT

# Add contact
./crm add contact "Name" "Company"

# Add deal
./crm add deal "Deal Name" "Contact" "Pipeline"
```

**CRITICAL:** NEVER read CRM.md - it doesn't exist. CRM is Google Sheets accessed via CLI.

### Session Management

```bash
# List active sessions
jfl session list

# Create new session
jfl session create [name]

# Session status
jfl status

# Current session ID
git branch --show-current
```

---

## 5. Multi-Agent Orchestration

### Agent Registry Discovery

**Auto-discover service agents on session start:**

```bash
# Scan for agent definitions
discover_agents() {
  local agent_dir="$WORKSPACE/.jfl/agents"

  if [[ ! -d "$agent_dir" ]]; then
    echo "{}" # No agents defined
    return
  fi

  local registry="{"

  for agent_file in "$agent_dir"/*.yaml; do
    [[ ! -f "$agent_file" ]] && continue

    local name=$(basename "$agent_file" .yaml)
    local desc=$(yq '.description' "$agent_file" 2>/dev/null || echo "")
    local deps=$(yq -r '.dependencies[]?' "$agent_file" 2>/dev/null | paste -sd "," -)

    registry="$registry\"$name\":{\"description\":\"$desc\",\"dependencies\":\"$deps\"},"
  done

  registry="${registry%,}}"  # Remove trailing comma

  echo "$registry"
}

# Load agent registry
AGENT_REGISTRY=$(discover_agents)
echo "🤖 Discovered agents: $(echo "$AGENT_REGISTRY" | jq -r 'keys[]' | paste -sd ", ")"
```

### Coordinator Decision Engine

**When user makes a request, the coordinator:**

1. **Classifies request type** (feature, bugfix, refactor, etc.)
2. **Extracts affected domains** (api, frontend, docs, database, etc.)
3. **Finds relevant agents** from registry
4. **Builds task graph** with dependencies
5. **Executes in dependency order** (topological sort)

```bash
# Coordinator logic
coordinate_request() {
  local user_request="$1"

  # Classify request
  local request_type=$(classify_request "$user_request")

  # Extract domains
  local domains=$(extract_domains "$user_request")

  # Find agents
  local agents=()
  for domain in $domains; do
    matching_agent=$(find_agent_for_domain "$domain")
    [[ -n "$matching_agent" ]] && agents+=("$matching_agent")
  done

  # Build task graph
  local task_plan=$(build_task_plan "${agents[@]}")

  # Execute tasks
  execute_task_plan "$task_plan"
}

# Helper: Classify request
classify_request() {
  local request="$1"

  if echo "$request" | grep -qi "add\|create\|build\|implement"; then
    echo "feature"
  elif echo "$request" | grep -qi "fix\|bug\|error\|broken"; then
    echo "bugfix"
  elif echo "$request" | grep -qi "refactor\|clean\|improve"; then
    echo "refactor"
  elif echo "$request" | grep -qi "update\|change\|modify"; then
    echo "update"
  else
    echo "general"
  fi
}

# Helper: Extract domains
extract_domains() {
  local request="$1"
  local domains=""

  echo "$request" | grep -qi "api\|endpoint\|route\|server" && domains="$domains api"
  echo "$request" | grep -qi "frontend\|ui\|component\|page\|react" && domains="$domains frontend"
  echo "$request" | grep -qi "docs\|documentation\|readme" && domains="$domains docs"
  echo "$request" | grep -qi "database\|db\|schema\|table" && domains="$domains database"
  echo "$request" | grep -qi "auth\|login\|user" && domains="$domains auth"

  echo "$domains" | xargs  # Trim whitespace
}

# Helper: Find agent for domain
find_agent_for_domain() {
  local domain="$1"

  # Check if agent exists for this domain
  if echo "$AGENT_REGISTRY" | jq -e ".\"$domain\"" &>/dev/null; then
    echo "$domain"
  fi
}

# Helper: Build task plan
build_task_plan() {
  local agents=("$@")
  local plan="{"
  local task_id=1

  for agent in "${agents[@]}"; do
    local deps=$(echo "$AGENT_REGISTRY" | jq -r ".\"$agent\".dependencies // \"\"")

    plan="$plan\"task-$task_id\":{\"agent\":\"$agent\",\"dependencies\":\"$deps\",\"status\":\"pending\"},"
    task_id=$((task_id + 1))
  done

  plan="${plan%,}}"

  echo "$plan"
}
```

### Agent Spawning & Execution

```bash
# Spawn a service agent
spawn_agent() {
  local agent_name="$1"
  local task_instructions="$2"
  local task_id="$3"

  echo "🤖 Spawning $agent_name agent (Task: $task_id)..."

  # Get agent config
  local agent_file="$WORKSPACE/.jfl/agents/${agent_name}.yaml"

  if [[ ! -f "$agent_file" ]]; then
    echo "❌ Agent definition not found: $agent_file"
    return 1
  fi

  # Load agent context files
  local context_files=$(yq -r '.context.files[]?' "$agent_file")
  local knowledge_docs=$(yq -r '.context.knowledge[]?' "$agent_file")

  # Create agent session
  local agent_session="agent-${agent_name}-${task_id}"

  # Option 1: Spawn OpenClaw session (if supported)
  if command -v openclaw &> /dev/null; then
    # Launch OpenClaw with agent context
    openclaw session create "$agent_session" \
      --context-files="$context_files" \
      --knowledge="$knowledge_docs" \
      --task="$task_instructions" \
      --workspace="$WORKSPACE" &

    local agent_pid=$!
    echo "$agent_pid" > "/tmp/jfl-agent-${agent_name}-${task_id}.pid"

  # Option 2: tmux session fallback
  else
    tmux new-session -d -s "$agent_session" \
      "cd $WORKSPACE && echo 'Agent: $agent_name' && echo 'Task: $task_instructions' && bash"

    echo "Agent spawned in tmux session: $agent_session"
    echo "Attach with: tmux attach -t $agent_session"
  fi

  # Write task to Context Hub
  curl -s -X POST "$CONTEXT_HUB_URL/api/tasks" \
    -H "Content-Type: application/json" \
    -d "{
      \"task_id\": \"$task_id\",
      \"agent\": \"$agent_name\",
      \"status\": \"in_progress\",
      \"instructions\": \"$task_instructions\",
      \"started_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")\"
    }" &>/dev/null

  echo "✅ $agent_name agent spawned"
}

# Wait for agent completion
wait_for_agent() {
  local agent_name="$1"
  local task_id="$2"
  local timeout="${3:-300}"  # 5 minutes default

  echo -n "⏳ Waiting for $agent_name to complete... "

  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    # Check Context Hub for completion signal
    local status=$(curl -s "$CONTEXT_HUB_URL/api/tasks/$task_id" | jq -r '.status')

    if [[ "$status" == "complete" ]]; then
      echo "✅ Complete"
      return 0
    elif [[ "$status" == "failed" ]]; then
      echo "❌ Failed"
      return 1
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "⏰ Timeout"
  return 1
}

# Get agent result
get_agent_result() {
  local task_id="$1"

  curl -s "$CONTEXT_HUB_URL/api/tasks/$task_id" | jq -r '.result'
}
```

### Task Execution Pipeline

```bash
# Execute task plan with dependency ordering
execute_task_plan() {
  local plan="$1"

  echo ""
  echo "📋 Task Plan:"
  echo "$plan" | jq .
  echo ""

  local completed=()
  local queue=()

  # Add tasks with no dependencies to queue
  while IFS= read -r task_id; do
    local deps=$(echo "$plan" | jq -r ".\"$task_id\".dependencies")

    if [[ -z "$deps" ]] || [[ "$deps" == "null" ]] || [[ "$deps" == "" ]]; then
      queue+=("$task_id")
    fi
  done < <(echo "$plan" | jq -r 'keys[]')

  # Process queue
  while [[ ${#queue[@]} -gt 0 ]]; do
    local current_task="${queue[0]}"
    queue=("${queue[@]:1}")  # Remove first element

    local agent=$(echo "$plan" | jq -r ".\"$current_task\".agent")
    local instructions="Task from user request"  # Should be extracted from context

    # Spawn agent
    spawn_agent "$agent" "$instructions" "$current_task"

    # Wait for completion
    if wait_for_agent "$agent" "$current_task"; then
      completed+=("$current_task")

      # Get result
      local result=$(get_agent_result "$current_task")
      echo "Result: $result"

      # Add newly unblocked tasks
      while IFS= read -r task_id; do
        local deps=$(echo "$plan" | jq -r ".\"$task_id\".dependencies")

        # Check if all dependencies completed
        local all_deps_met=true
        for dep in $deps; do
          if [[ ! " ${completed[@]} " =~ " ${dep} " ]]; then
            all_deps_met=false
            break
          fi
        done

        if $all_deps_met && [[ ! " ${queue[@]} " =~ " ${task_id} " ]]; then
          queue+=("$task_id")
        fi
      done < <(echo "$plan" | jq -r 'keys[]')
    else
      echo "❌ Agent failed: $agent"
    fi
  done

  echo ""
  echo "✅ All tasks complete"

  # Synthesize results
  synthesize_results "${completed[@]}"
}

# Synthesize final results
synthesize_results() {
  local task_ids=("$@")

  echo ""
  echo "📊 Session Summary"
  echo ""
  echo "Tasks completed: ${#task_ids[@]}"
  echo ""

  for task_id in "${task_ids[@]}"; do
    local agent=$(curl -s "$CONTEXT_HUB_URL/api/tasks/$task_id" | jq -r '.agent')
    local result=$(curl -s "$CONTEXT_HUB_URL/api/tasks/$task_id" | jq -r '.result.summary // "No summary"')
    local files=$(curl -s "$CONTEXT_HUB_URL/api/tasks/$task_id" | jq -r '.result.files[]? // empty')

    echo "✅ $agent: $result"
    if [[ -n "$files" ]]; then
      echo "   Files: $files"
    fi
  done

  echo ""

  # Show total time
  local start=$(curl -s "$CONTEXT_HUB_URL/api/tasks/${task_ids[0]}" | jq -r '.started_at')
  local end=$(curl -s "$CONTEXT_HUB_URL/api/tasks/${task_ids[-1]}" | jq -r '.completed_at')

  echo "Total time: $(( $(date -d "$end" +%s) - $(date -d "$start" +%s) ))s"
  echo ""
}
```

### Example: User Request Handling

```bash
# When user says: "Add a login endpoint"
user_request="Add a login endpoint with email and password"

# Coordinator analyzes
echo "🧠 Analyzing request..."
request_type=$(classify_request "$user_request")  # "feature"
domains=$(extract_domains "$user_request")        # "api auth"

echo "Type: $request_type"
echo "Domains: $domains"
echo ""

# Find agents
agents=()
for domain in $domains; do
  agent=$(find_agent_for_domain "$domain")
  [[ -n "$agent" ]] && agents+=("$agent")
done

echo "Agents needed: ${agents[*]}"
echo ""

# Build plan
task_plan=$(build_task_plan "${agents[@]}")

echo "Task plan:"
echo "$task_plan" | jq .
echo ""

# Execute
execute_task_plan "$task_plan"
```

---

## 6. Service Management

### Context Hub (Required)

```bash
# Auto-start on session init
jfl context-hub ensure

# Verify running
curl -s "$CONTEXT_HUB_URL/health" || {
  echo "Context Hub not running!"
  jfl context-hub start
}

# Monitor logs
jfl context-hub logs

# CRITICAL: NEVER stop Context Hub during session end
# It's shared across all sessions
```

### Auto-Commit (Recommended)

```bash
# Start background auto-commit (every 2 minutes)
if [[ -f "$WORKSPACE/scripts/session/auto-commit.sh" ]]; then
  "$WORKSPACE/scripts/session/auto-commit.sh" start
  echo "✅ Auto-commit started (saves every 2 minutes)"
fi

# Custom interval (60 seconds)
# "$WORKSPACE/scripts/session/auto-commit.sh" start 60

# Stop (not recommended during session)
# "$WORKSPACE/scripts/session/auto-commit.sh" stop
```

**Why:** Prevents data loss if session crashes or terminal closes.

### Deployment

```bash
# Fly.io deployment (if configured)
jfl fly-deploy status
jfl fly-deploy logs
jfl fly-deploy scale
```

### TUI Interfaces

```bash
# Launch ralph-tui (agent loop orchestrator)
launch_ralph_tui() {
  if command -v jfl &> /dev/null; then
    # Check if already running
    if tmux has-session -t jfl-ralph 2>/dev/null; then
      echo "Ralph TUI already running in session: jfl-ralph"
      echo "Attach with: tmux attach -t jfl-ralph"
    else
      tmux new-session -d -s jfl-ralph "cd $WORKSPACE && jfl ralph-tui"
      echo "✅ Ralph TUI launched in tmux session: jfl-ralph"
      echo "Attach with: tmux attach -t jfl-ralph"
    fi
  fi
}

# Launch campaign-hud (dashboard TUI)
launch_campaign_hud() {
  if command -v jfl &> /dev/null; then
    if tmux has-session -t jfl-campaign 2>/dev/null; then
      echo "Campaign HUD already running in session: jfl-campaign"
      echo "Attach with: tmux attach -t jfl-campaign"
    else
      tmux new-session -d -s jfl-campaign "cd $WORKSPACE && jfl campaign-hud"
      echo "✅ Campaign HUD launched in tmux session: jfl-campaign"
      echo "Attach with: tmux attach -t jfl-campaign"
    fi
  fi
}
```

---

## 7. Session End Protocol

### When User Says "Done"

```bash
end_session() {
  echo ""
  echo "🏁 Ending GTM session..."
  echo ""

  # Step 1: Verify journal entry exists
  echo "1️⃣ Checking journal entries..."

  SESSION=$(git -C "$WORKSPACE" branch --show-current 2>/dev/null || echo "openclaw-session")
  JOURNAL_FILE="$WORKSPACE/.jfl/journal/${SESSION}.jsonl"

  if [[ ! -s "$JOURNAL_FILE" ]]; then
    echo ""
    echo "⚠️  STOP - JOURNAL ENTRY REQUIRED"
    echo ""
    echo "You MUST write a journal entry before ending the session."
    echo "What did you work on this session?"
    echo ""
    read -p "Press Enter when journal entry is written..."

    # Check again
    if [[ ! -s "$JOURNAL_FILE" ]]; then
      echo "❌ Still no journal entry. Session end aborted."
      return 1
    fi
  fi

  echo "✅ Journal entry verified"

  # Step 2: Commit outstanding changes
  echo ""
  echo "2️⃣ Committing changes..."

  cd "$WORKSPACE"

  if [[ -n "$(git status --porcelain)" ]]; then
    git add knowledge/ content/ suggestions/ .jfl/ CLAUDE.md 2>/dev/null
    git commit -m "session: end $(date +%Y-%m-%d)" &>/dev/null || true
    git push origin &>/dev/null || true
    echo "✅ Changes committed and pushed"
  else
    echo "✅ No uncommitted changes"
  fi

  # Step 3: Session summary
  echo ""
  echo "3️⃣ Session summary"
  echo ""
  echo "Work done:"
  cat "$JOURNAL_FILE" | jq -r '.title' 2>/dev/null | tail -5 || echo "  (No entries)"

  echo ""
  echo "Files changed:"
  git diff --name-only HEAD~5 HEAD 2>/dev/null | head -10 || echo "  (No changes)"

  echo ""
  echo "Next steps:"
  cat "$JOURNAL_FILE" | jq -r '.next // empty' 2>/dev/null | tail -1 || echo "  (Not specified)"

  # Step 4: Cleanup
  echo ""
  echo "4️⃣ Cleanup"

  # Sync one final time
  git push origin &>/dev/null || true

  # DON'T stop Context Hub (shared service)
  # DON'T stop auto-commit (let it run)

  echo "✅ Context Hub still running (shared across sessions)"
  echo "✅ Auto-commit still running (preserves work)"

  echo ""
  echo "✅ Session ended cleanly"
  echo "📊 Context preserved for next session"
  echo ""
}

# Export function
export -f end_session
```

---

## 8. Main Skill Entry Point

### Complete Flow

```bash
#!/bin/bash

set -e

# 1. Workspace Discovery & Selection
# (Code from Section 1)
[workspace discovery and selection code]

# 2. Session Initialization
# (Code from Section 2)
[session initialization code]

# 3. Export Helper Functions
export -f write_journal_entry
export -f capture_decision
export -f spawn_agent
export -f wait_for_agent
export -f get_agent_result
export -f execute_task_plan
export -f end_session

# 4. Agent Registry
AGENT_REGISTRY=$(discover_agents)
export AGENT_REGISTRY

# 5. Enter Interactive Mode
echo ""
echo "🚀 GTM Session Active"
echo ""
echo "You have full access to:"
echo "  • Journal protocols (write_journal_entry)"
echo "  • Decision capture (capture_decision)"
echo "  • JFL CLI tools (jfl synopsis, ./crm, etc.)"
echo "  • Service management (Context Hub, auto-commit, TUI)"
echo "  • Multi-agent orchestration (spawn_agent, coordinate_request)"
echo ""
echo "Example commands:"
echo "  • jfl synopsis 24           - What happened in last 24 hours"
echo "  • ./crm list                - Show CRM pipeline"
echo "  • launch_ralph_tui          - Start agent orchestrator"
echo "  • end_session               - End session gracefully"
echo ""

# Keep session alive
# OpenClaw will take over from here with full context
```

---

## Notes for OpenClaw Implementation

### Permission Model

This skill requires **elevated permissions**:
- ✅ File writes to `knowledge/`, `journal/`, `content/` without confirmation
- ✅ Command execution (`jfl`, `./crm`, `git`) without prompts
- ✅ Network access (Context Hub, Fly, external APIs) without blocks

This is necessary because GTM workflows involve:
- Real-time journal entry writing
- Immediate knowledge doc updates
- Automatic context preservation
- No user friction during operation

### Context Awareness

The skill operates with full awareness of:
- CLAUDE.md (the instruction manual)
- Project foundation (VISION, ROADMAP, NARRATIVE, THESIS)
- Brand guidelines (BRAND_DECISIONS, VOICE_AND_TONE)
- Product specs (product/SPEC.md, product/*.md)
- CRM pipeline (via ./crm CLI)
- Active sessions (via jfl session list)
- Recent work (via jfl synopsis)
- Multi-agent coordination (via Context Hub)

### Integration Points

**With OpenClaw:**
- Skill gating: Requires `jfl` and `git` binaries
- Environment: Requires `CONTEXT_HUB_URL`
- Permissions: Needs file write, command execution, network access

**With JFL CLI:**
- Context Hub MCP server
- Synopsis command
- CRM CLI wrapper
- Session management
- Service control

**With Context Hub:**
- HTTP API for context queries
- Task queue for agent coordination
- Agent communication protocol
- Completion signals

### Future Enhancements

- **Real-time Context Hub updates** (websocket)
- **Web-based TUI embedding** (if OpenClaw has web UI)
- **Multi-workspace parallel operation**
- **Agent learning** (agents remember patterns)
- **External agent support** (agents via MCP)
- **Visual agent designer** (GUI for .jfl/agents/*.yaml)
- **Agent performance metrics** (track efficiency)

---

## Resources

- **JFL CLI**: https://github.com/402goose/just-fucking-launch
- **GTM Docs**: See CLAUDE.md in your workspace
- **Context Hub**: http://localhost:4242 (when running)
- **Issues**: https://github.com/402goose/openclaw-jfl-gtm/issues
