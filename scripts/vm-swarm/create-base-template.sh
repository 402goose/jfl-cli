#!/bin/bash
#
# create-base-template.sh — Create base VM template for agent fleet
#
# Creates a macOS VM template with all dependencies pre-installed,
# ready to be cloned for agent fleet operations.
#
# Usage:
#   ./create-base-template.sh                  # Create with defaults
#   ./create-base-template.sh --name my-base   # Custom name
#   ./create-base-template.sh --skip-snapshot  # Don't create snapshot
#
# Prerequisites:
#   - Parallels Desktop Pro
#   - macOS installer app or pre-existing VM to clone from
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Defaults
TEMPLATE_NAME="jfl-agent-base"
SOURCE_VM=""
CREATE_SNAPSHOT=true
MEMORY_MB=4096
CPU_COUNT=2

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ✗${NC} $1"; exit 1; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --name|-n)
            TEMPLATE_NAME="$2"
            shift 2
            ;;
        --source|-s)
            SOURCE_VM="$2"
            shift 2
            ;;
        --skip-snapshot)
            CREATE_SNAPSHOT=false
            shift
            ;;
        --memory|-m)
            MEMORY_MB="$2"
            shift 2
            ;;
        --cpus|-c)
            CPU_COUNT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --name, -n <name>     Template VM name (default: jfl-agent-base)"
            echo "  --source, -s <vm>     Source VM to clone from"
            echo "  --skip-snapshot       Don't create snapshot after setup"
            echo "  --memory, -m <MB>     Memory in MB (default: 4096)"
            echo "  --cpus, -c <count>    CPU count (default: 2)"
            echo ""
            echo "Examples:"
            echo "  $0 --source 'macOS 14'     # Clone from existing VM"
            echo "  $0 --memory 8192 --cpus 4  # Beefier template"
            echo ""
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

check_prerequisites() {
    if ! command -v prlctl &> /dev/null; then
        error "prlctl not found. Install Parallels Desktop Pro."
    fi

    # Check Parallels version supports what we need
    local version
    version=$(prlctl --version 2>/dev/null | head -1 || echo "unknown")
    log "Parallels version: $version"
}

find_source_vm() {
    if [[ -n "$SOURCE_VM" ]]; then
        if ! prlctl list --all | grep -q "$SOURCE_VM"; then
            error "Source VM '$SOURCE_VM' not found"
        fi
        return
    fi

    # Try to find a suitable source VM
    log "Looking for suitable source VM..."

    local vms
    vms=$(prlctl list --all -o name 2>/dev/null | tail -n +2)

    if [[ -z "$vms" ]]; then
        error "No VMs found. Create a macOS VM first or specify --source"
    fi

    # Look for macOS VMs
    for vm in $vms; do
        if [[ "$vm" == *"macOS"* ]] || [[ "$vm" == *"Sonoma"* ]] || [[ "$vm" == *"Ventura"* ]]; then
            SOURCE_VM="$vm"
            log "Found source VM: $SOURCE_VM"
            return
        fi
    done

    # If no macOS VM found, use the first one
    SOURCE_VM=$(echo "$vms" | head -1)
    warn "No macOS VM found, using: $SOURCE_VM"
}

create_template() {
    log "Creating template VM: $TEMPLATE_NAME"

    # Check if template already exists
    if prlctl list --all | grep -q "$TEMPLATE_NAME"; then
        warn "Template '$TEMPLATE_NAME' already exists"
        read -p "Delete and recreate? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log "Deleting existing template..."
            prlctl stop "$TEMPLATE_NAME" --kill 2>/dev/null || true
            sleep 2
            prlctl delete "$TEMPLATE_NAME" 2>/dev/null || true
        else
            log "Keeping existing template"
            return
        fi
    fi

    # Clone from source
    log "Cloning from '$SOURCE_VM'..."
    prlctl clone "$SOURCE_VM" --name "$TEMPLATE_NAME"

    success "Template VM created"
}

configure_template() {
    log "Configuring template VM..."

    # Set memory and CPUs
    prlctl set "$TEMPLATE_NAME" --memsize "$MEMORY_MB"
    prlctl set "$TEMPLATE_NAME" --cpus "$CPU_COUNT"

    # Enable nested virtualization if available
    prlctl set "$TEMPLATE_NAME" --nested-virt on 2>/dev/null || true

    # Set optimal settings for agent workloads
    prlctl set "$TEMPLATE_NAME" --adaptive-hypervisor on 2>/dev/null || true
    prlctl set "$TEMPLATE_NAME" --faster-vm on 2>/dev/null || true

    success "Template configured: ${MEMORY_MB}MB RAM, ${CPU_COUNT} CPUs"
}

start_and_wait() {
    log "Starting template VM..."
    prlctl start "$TEMPLATE_NAME"

    # Wait for VM to be ready
    local max_wait=120
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        if prlctl exec "$TEMPLATE_NAME" echo "ready" &> /dev/null; then
            success "VM is ready"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
        log "Waiting for VM... (${waited}s)"
    done

    error "VM did not become ready within ${max_wait}s"
}

install_dependencies() {
    log "Installing dependencies in template VM..."

    # Install Homebrew if not present
    log "Checking for Homebrew..."
    if ! prlctl exec "$TEMPLATE_NAME" /bin/bash -c "command -v brew" &> /dev/null; then
        log "Installing Homebrew..."
        prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        ' || warn "Homebrew installation may have failed"
    fi

    # Install Node.js
    log "Installing Node.js..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        export PATH="/opt/homebrew/bin:$PATH"
        brew install node || true
        node --version
    '

    # Install Git
    log "Installing Git..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        export PATH="/opt/homebrew/bin:$PATH"
        brew install git || true
        git --version
    '

    # Install JFL CLI
    log "Installing JFL CLI..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        export PATH="/opt/homebrew/bin:$PATH"
        npm install -g jfl || true
        jfl --version 2>/dev/null || echo "JFL installed"
    '

    # Create workspace directory
    log "Creating workspace directory..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        mkdir -p /workspace
        chmod 755 /workspace
    '

    # Clone repositories
    log "Cloning JFL repositories..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        export PATH="/opt/homebrew/bin:$PATH"
        cd /workspace

        # Clone jfl-cli if not present
        if [[ ! -d "jfl-cli" ]]; then
            git clone https://github.com/402goose/jfl-cli.git 2>/dev/null || true
        fi

        # Clone jfl-platform if not present
        if [[ ! -d "jfl-platform" ]]; then
            git clone https://github.com/402goose/jfl-platform.git 2>/dev/null || true
        fi

        ls -la /workspace/
    '

    # Install dependencies in repos
    log "Installing project dependencies..."
    prlctl exec "$TEMPLATE_NAME" /bin/bash -c '
        export PATH="/opt/homebrew/bin:$PATH"

        if [[ -d "/workspace/jfl-cli" ]]; then
            cd /workspace/jfl-cli
            npm install || yarn install || true
        fi
    '

    success "Dependencies installed"
}

create_snapshot() {
    if [[ "$CREATE_SNAPSHOT" != true ]]; then
        log "Skipping snapshot creation (--skip-snapshot)"
        return
    fi

    log "Creating snapshot 'fresh-install'..."

    # Stop VM first for clean snapshot
    prlctl stop "$TEMPLATE_NAME" 2>/dev/null || true
    sleep 5

    # Create snapshot
    prlctl snapshot "$TEMPLATE_NAME" --name "fresh-install" \
        --description "Clean install with all dependencies"

    success "Snapshot 'fresh-install' created"
}

stop_template() {
    log "Stopping template VM..."
    prlctl stop "$TEMPLATE_NAME" 2>/dev/null || true
    sleep 3
    success "Template stopped"
}

print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    success "Base template created successfully!"
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Template: $TEMPLATE_NAME"
    echo "Source:   $SOURCE_VM"
    echo "Memory:   ${MEMORY_MB}MB"
    echo "CPUs:     $CPU_COUNT"
    echo ""
    echo "The template includes:"
    echo "  • macOS with Homebrew"
    echo "  • Node.js and Git"
    echo "  • JFL CLI"
    echo "  • /workspace directory with repos"
    echo "  • Snapshot 'fresh-install'"
    echo ""
    echo "Next steps:"
    echo "  1. Spawn agent fleet: ./spawn-fleet.sh 5 $TEMPLATE_NAME autoresearch"
    echo "  2. Monitor fleet:     ./monitor-fleet.sh"
    echo "  3. Collect results:   ./collect-tuples.sh"
    echo ""
}

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    echo "  JFL Agent Base Template Creator"
    echo "═══════════════════════════════════════════════════════════"
    echo ""

    check_prerequisites
    find_source_vm
    create_template
    configure_template
    start_and_wait
    install_dependencies
    create_snapshot
    stop_template
    print_summary
}

main
