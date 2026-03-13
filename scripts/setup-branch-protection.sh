#!/usr/bin/env bash
set -euo pipefail

# Setup branch protection for 402goose/jfl-cli
# Requires: admin access to the repo
# Usage: ./scripts/setup-branch-protection.sh

REPO="402goose/jfl-cli"
BRANCH="main"

echo "Setting up branch protection for $REPO ($BRANCH)..."
echo ""

# Method 1: Repository rulesets (preferred — newer API, more flexible)
echo "Attempting rulesets API..."
if gh api "repos/$REPO/rulesets" \
  --method POST \
  --input - <<'EOF' 2>/dev/null; then
{
  "name": "Require CI + Sentinel before merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          {
            "context": "build-and-test",
            "integration_id": null
          },
          {
            "context": "PR Sentinel",
            "integration_id": null
          }
        ]
      }
    },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ]
}
EOF
  echo "✅ Ruleset created successfully"
  exit 0
fi

echo "Rulesets API failed, trying branch protection API..."

# Method 2: Classic branch protection (fallback)
if gh api "repos/$REPO/branches/$BRANCH/protection" \
  --method PUT \
  --input - <<'EOF' 2>/dev/null; then
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "build-and-test",
      "PR Sentinel"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
  echo "✅ Branch protection configured successfully"
  exit 0
fi

echo ""
echo "❌ Both APIs returned 404. You need admin access to $REPO."
echo ""
echo "Manual setup (GitHub UI):"
echo "  1. Go to: https://github.com/$REPO/settings/rules"
echo "  2. Click 'New ruleset'"
echo "  3. Name: 'Require CI + Sentinel before merge'"
echo "  4. Enforcement: Active"
echo "  5. Target branches: Add 'main'"
echo "  6. Add rule: 'Require status checks to pass'"
echo "     - Check 'Require branches to be up to date'"
echo "     - Add checks: 'build-and-test', 'PR Sentinel'"
echo "  7. Add rule: 'Require a pull request before merging'"
echo "     - Required approvals: 0"
echo "  8. Save"
echo ""
echo "This prevents merging PRs until both CI and Sentinel have run."
exit 1
