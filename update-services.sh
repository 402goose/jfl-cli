#!/bin/bash
#
# Update /end skill in existing services
#

set -e

if [ -z "$1" ]; then
    echo "Usage: ./update-services.sh <service-path>"
    echo ""
    echo "Example:"
    echo "  ./update-services.sh ~/code/my-service"
    echo ""
    echo "Or update all services in a directory:"
    echo "  for dir in ~/code/*/; do ./update-services.sh \"\$dir\"; done"
    exit 1
fi

SERVICE_PATH="$1"
TEMPLATE_SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/template/.claude/skills/end"

if [ ! -d "$SERVICE_PATH" ]; then
    echo "Error: Service path does not exist: $SERVICE_PATH"
    exit 1
fi

if [ ! -d "$TEMPLATE_SKILL" ]; then
    echo "Error: Template end skill not found at: $TEMPLATE_SKILL"
    exit 1
fi

echo "Updating /end skill in: $SERVICE_PATH"

# Create .claude/skills directory if it doesn't exist
mkdir -p "$SERVICE_PATH/.claude/skills"

# Copy the updated end skill
if [ -d "$SERVICE_PATH/.claude/skills/end" ]; then
    echo "  Backing up old /end skill..."
    mv "$SERVICE_PATH/.claude/skills/end" "$SERVICE_PATH/.claude/skills/end.backup.$(date +%Y%m%d-%H%M%S)"
fi

echo "  Copying new /end skill..."
cp -r "$TEMPLATE_SKILL" "$SERVICE_PATH/.claude/skills/end"

echo "✓ Updated successfully!"
echo ""
echo "The new /end skill includes:"
echo "  • Knowledge directory sync (knowledge/ → gtm/services/{name}/knowledge/)"
echo "  • Content directory sync (content/ → gtm/services/{name}/content/)"
echo "  • Config file sync (.jfl/config.json, service.json, .mcp.json)"
echo "  • CLAUDE.md sync"
echo "  • Enhanced display with sync statistics"
echo ""
echo "To enable content sync, update .jfl/config.json:"
echo '  jq '\''.sync_to_parent = {journal: true, knowledge: true, content: true}'\'' .jfl/config.json > tmp && mv tmp .jfl/config.json'
