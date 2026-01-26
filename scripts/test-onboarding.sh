#!/bin/bash
# Test JFL onboarding flow in isolated environment

set -e

TEST_DIR="/tmp/jfl-test-$(date +%s)"
CONFIG_BACKUP="$HOME/.config/jfl.backup-$(date +%s)"

echo "🧪 JFL Test Mode"
echo ""
echo "This will:"
echo "  1. Backup your current JFL config"
echo "  2. Clear config for fresh onboarding"
echo "  3. Create test directory: $TEST_DIR"
echo "  4. Launch JFL"
echo "  5. Restore your config when done"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Backup current config
if [ -d "$HOME/.config/jfl" ]; then
    echo "📦 Backing up config to $CONFIG_BACKUP"
    mv "$HOME/.config/jfl" "$CONFIG_BACKUP"
fi

# Create test directory
echo "📁 Creating test directory: $TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Cleanup function
cleanup() {
    echo ""
    echo "🧹 Cleaning up..."

    # Remove test config
    rm -rf "$HOME/.config/jfl"

    # Restore original config
    if [ -d "$CONFIG_BACKUP" ]; then
        echo "📦 Restoring config from $CONFIG_BACKUP"
        mv "$CONFIG_BACKUP" "$HOME/.config/jfl"
    fi

    # Ask about test directory
    echo ""
    read -p "Delete test directory $TEST_DIR? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$TEST_DIR"
        echo "✓ Test directory deleted"
    else
        echo "Test directory kept at: $TEST_DIR"
    fi

    echo ""
    echo "✓ Restored to normal state"
}

# Set trap to cleanup on exit
trap cleanup EXIT INT TERM

# Show environment
echo ""
echo "🎯 Test Environment Ready"
echo "   Config: Fresh (backed up to $CONFIG_BACKUP)"
echo "   Directory: $TEST_DIR"
echo ""
echo "Starting JFL..."
echo ""

# Launch JFL
jfl
