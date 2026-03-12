# VM Swarm — Parallel Agent Fleet for JFL

Run multiple AI agent instances in parallel using Parallels Desktop VMs.
Each VM is a full macOS environment with JFL installed, capable of running
autoresearch, fuzz testing, or evaluation independently.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host Machine                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    VM Swarm Controller                      │ │
│  │  spawn-fleet.sh │ monitor-fleet.sh │ collect-tuples.sh    │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ │
│  │  jfl-agent-1     │ │  jfl-agent-2     │ │  jfl-agent-N     │ │
│  │  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │ │
│  │  │ jfl-cli    │  │ │  │ jfl-cli    │  │ │  │ jfl-cli    │  │ │
│  │  │ claude-code│  │ │  │ claude-code│  │ │  │ claude-code│  │ │
│  │  │ autoresearch│ │ │  │ fuzz tests │  │ │  │ eval       │  │ │
│  │  └────────────┘  │ │  └────────────┘  │ │  └────────────┘  │ │
│  │  ┌────────────┐  │ │  ┌────────────┐  │ │  ┌────────────┐  │ │
│  │  │ training-  │  │ │  │ training-  │  │ │  │ training-  │  │ │
│  │  │ buffer.jsonl│ │ │  │ buffer.jsonl│ │ │  │ buffer.jsonl│ │ │
│  │  └────────────┘  │ │  └────────────┘  │ │  └────────────┘  │ │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ │
│              │               │               │                  │
│              └───────────────┼───────────────┘                  │
│                              ▼                                   │
│                   ┌──────────────────┐                          │
│                   │ Merged Training  │                          │
│                   │ Buffer (Host)    │                          │
│                   └──────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Hardware
- Mac with Apple Silicon (M1/M2/M3) or Intel
- 32GB+ RAM recommended (8GB per VM)
- 100GB+ free disk space

### Software
- **Parallels Desktop Pro** (required for `prlctl` command)
  - Standard edition does NOT include prlctl
  - Business or Pro license required
- macOS Sonoma or later (for VMs)
- Node.js 18+ on host

### Kernel Configuration (Important!)

By default, macOS limits virtualization memory. For large fleets, increase the limit:

```bash
# Check current limit
sysctl kern.hv_apple_isa_vm_quota

# Increase to 255GB (temporary, until reboot)
sudo sysctl -w kern.hv_apple_isa_vm_quota=255

# Make permanent (requires SIP disabled or MDM)
# Add to /Library/Preferences/SystemConfiguration/com.apple.Boot.plist
```

## Quick Start

### 1. Create Base Template

First, create a VM template with all dependencies:

```bash
# From an existing macOS VM
./create-base-template.sh --from-existing "macOS 14"

# Or from a macOS installer ISO
./create-base-template.sh --from-iso "/path/to/InstallmacOS.iso"
```

This creates a VM named `jfl-agent-base` with:
- Node.js + npm
- Git
- Claude Code
- jfl-cli (linked globally)
- jfl-platform, jfl-template repos
- Your `.env` file (for STRATUS keys)

### 2. Spawn Fleet

Spawn multiple VMs from the template:

```bash
# Default: 5 VMs running autoresearch
./spawn-fleet.sh

# Custom count and task
./spawn-fleet.sh 10 jfl-agent-base autoresearch
./spawn-fleet.sh 4 jfl-agent-base fuzz
./spawn-fleet.sh 3 jfl-agent-base eval
```

Task types:
- `autoresearch` — Each VM researches a different repo/service
- `fuzz` — Each VM runs a different fuzz test suite
- `eval` — Each VM runs evaluation with different profiles

### 3. Monitor Progress

Watch fleet status in real-time:

```bash
# One-time check
./monitor-fleet.sh

# Continuous monitoring (refreshes every 10s)
./monitor-fleet.sh --watch

# JSON output (for scripting)
./monitor-fleet.sh --json
```

Output shows:
- VM status (running/stopped)
- Current task
- Uptime
- Latest eval score
- Training tuple count

### 4. Collect Training Data

Aggregate training tuples from all VMs:

```bash
./collect-tuples.sh

# Verbose mode
./collect-tuples.sh --verbose

# Dry run (don't merge)
./collect-tuples.sh --dry-run
```

This:
- Copies `.jfl/training-buffer.jsonl` from each VM
- Merges into host's training buffer
- Deduplicates by tuple ID
- Reports per-VM counts and overall stats

### 5. Stop Fleet

Stop and optionally delete the VMs:

```bash
# Stop all VMs (keep them for later)
./kill-fleet.sh

# Stop and delete clones (keeps template)
./kill-fleet.sh --delete

# Collect tuples before killing
./kill-fleet.sh --collect

# Force kill (no graceful shutdown)
./kill-fleet.sh --force
```

## Workflow Examples

### Parallel Autoresearch

Run autoresearch across multiple code areas simultaneously:

```bash
# Spawn 5 VMs, each researching different parts of the codebase
./spawn-fleet.sh 5 jfl-agent-base autoresearch

# VMs will research:
# - VM 1: jfl-cli/src/commands
# - VM 2: jfl-cli/src/lib
# - VM 3: jfl-platform/packages/memory
# - VM 4: jfl-platform/packages/eval
# - VM 5: jfl-template/knowledge

# Monitor progress
./monitor-fleet.sh --watch

# After ~1 hour, collect training tuples
./collect-tuples.sh

# Clean up
./kill-fleet.sh --delete
```

### Parallel Fuzz Testing

Run all fuzz test suites in parallel:

```bash
./spawn-fleet.sh 4 jfl-agent-base fuzz

# VMs will run:
# - VM 1: fuzz-scope tests
# - VM 2: fuzz-events tests
# - VM 3: fuzz-training tests
# - VM 4: fuzz-hub-api tests

./monitor-fleet.sh --watch
```

### Overnight Training Run

Set up a long-running training session:

```bash
# Start fleet
./spawn-fleet.sh 10 jfl-agent-base autoresearch

# Set up periodic collection (run in separate terminal)
while true; do
    sleep 3600  # Every hour
    ./collect-tuples.sh
done

# Or use cron:
# 0 * * * * /path/to/collect-tuples.sh >> /tmp/collect.log 2>&1
```

## File Locations

| File | Purpose |
|------|---------|
| `.jfl/vm-fleet/` | Fleet logs and state |
| `.jfl/vm-fleet/vm-N.log` | Log for VM N |
| `.jfl/vm-fleet/running-tasks` | Current task assignments |
| `.jfl/vm-fleet/fleet-started` | Fleet start timestamp |
| `.jfl/vm-fleet/collected/` | Collected training buffers |
| `.jfl/training-buffer.jsonl` | Merged training data |

## Troubleshooting

### "prlctl not found"

Install Parallels Desktop Pro. The standard edition doesn't include prlctl.

### "VM quota exceeded"

Increase the VM memory quota:
```bash
sudo sysctl -w kern.hv_apple_isa_vm_quota=255
```

### VM won't start

Check available resources:
```bash
# See running VMs
prlctl list -a

# Check VM details
prlctl list -i jfl-agent-1
```

### Collect fails

Ensure VMs are running and have generated training data:
```bash
# Check if buffer exists in VM
prlctl exec jfl-agent-1 ls -la /workspace/jfl-cli/.jfl/
```

### Template creation fails

If creating from ISO, manual macOS installation is required:
1. Run `create-base-template.sh --from-iso <path>`
2. Complete macOS Setup Assistant in the VM
3. Run `create-base-template.sh --setup-only` to install dependencies

## Resource Usage

Approximate resource usage per VM:
- CPU: 4 cores
- RAM: 8GB
- Disk: 20GB (linked clone from template)

For a 5-VM fleet:
- CPU: 20 cores utilized
- RAM: 40GB
- Disk: 50GB base + 100GB template

## Tips

1. **Start small** — Test with 2-3 VMs before scaling up
2. **Use linked clones** — spawn-fleet.sh uses linked clones by default (fast, space-efficient)
3. **Collect often** — Run `collect-tuples.sh` periodically to avoid data loss if VMs crash
4. **Monitor costs** — Each VM running Claude Code incurs API costs
5. **Clean up** — Delete unused VMs to free disk space
