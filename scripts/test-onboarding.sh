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

    # Check for created GitHub repos in test directory
    CREATED_REPOS=()
    if [ -d "$TEST_DIR" ]; then
        # Find any directories with .git in them (product repos)
        for dir in "$TEST_DIR"/*/product; do
            if [ -d "$dir/.git" ]; then
                # Get repo name from git remote
                cd "$dir" 2>/dev/null || continue
                REPO_URL=$(git remote get-url origin 2>/dev/null || echo "")
                if [[ -n "$REPO_URL" ]]; then
                    # Extract repo name from URL (e.g., github.com:user/repo.git -> repo)
                    REPO_NAME=$(basename "$REPO_URL" .git)
                    CREATED_REPOS+=("$REPO_NAME")
                fi
            fi
        done
    fi

    # Ask about deleting GitHub repos
    if [ ${#CREATED_REPOS[@]} -gt 0 ]; then
        echo ""
        echo "Found ${#CREATED_REPOS[@]} test repo(s) on GitHub:"
        for repo in "${CREATED_REPOS[@]}"; do
            echo "  - $repo"
        done
        echo ""
        read -p "Delete these repos from GitHub? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            for repo in "${CREATED_REPOS[@]}"; do
                echo "Deleting $repo from GitHub..."
                if gh repo delete "$repo" --yes 2>/dev/null; then
                    echo "  ✓ Deleted: $repo"
                else
                    echo "  ⚠️  Failed to delete: $repo (may need to delete manually)"
                fi
            done
        else
            echo "Repos kept on GitHub"
        fi
    fi

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
