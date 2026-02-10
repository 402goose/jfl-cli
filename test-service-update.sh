#!/bin/bash
# Test script for service update flow

set -e

echo "🧪 Testing Service Update Flow"
echo "==============================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test 1: Check service-utils functions exist
echo "Test 1: Verify service-utils module exists..."
if [ -f "dist/lib/service-utils.js" ]; then
  echo -e "${GREEN}✓${NC} service-utils.js compiled successfully"
else
  echo -e "${RED}✗${NC} service-utils.js not found"
  exit 1
fi

# Test 2: Check version tracking
echo ""
echo "Test 2: CLI version tracking..."
node -e "
  const { getCurrentCliVersion, readCliVersion, writeCliVersion } = require('./dist/lib/service-utils.js');
  const version = getCurrentCliVersion();
  console.log('Current CLI version:', version);

  // Test writing version
  writeCliVersion(version);
  console.log('✓ Version written to XDG data directory');

  // Test reading version
  const stored = readCliVersion();
  if (stored && stored.version === version) {
    console.log('✓ Version read successfully:', stored.version);
  } else {
    console.error('✗ Version mismatch');
    process.exit(1);
  }
"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Version tracking works"
else
  echo -e "${RED}✗${NC} Version tracking failed"
  exit 1
fi

# Test 3: Service Manager has ensure subcommand
echo ""
echo "Test 3: Service Manager ensure subcommand..."
./dist/index.js service-manager 2>&1 | grep -q "ensure"
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} service-manager has 'ensure' subcommand"
else
  echo -e "${RED}✗${NC} service-manager missing 'ensure' subcommand"
  exit 1
fi

# Test 4: Services command has health and restart
echo ""
echo "Test 4: Services command new subcommands..."
./dist/index.js services invalid 2>&1 | grep -q "health"
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} services has 'health' subcommand"
else
  echo -e "${RED}✗${NC} services missing 'health' subcommand"
  exit 1
fi

./dist/index.js services invalid 2>&1 | grep -q "restart"
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} services has 'restart' subcommand"
else
  echo -e "${RED}✗${NC} services missing 'restart' subcommand"
  exit 1
fi

# Test 5: Service health checks
echo ""
echo "Test 5: Service health validation..."
node -e "
  const { validateCoreServices } = require('./dist/lib/service-utils.js');

  validateCoreServices().then(result => {
    console.log('Health check completed');
    console.log('Healthy:', result.healthy);
    console.log('Issues:', result.issues.length);

    if (result.issues.length > 0) {
      console.log('⚠️  Some services not running (expected in test environment)');
      for (const issue of result.issues) {
        console.log('  -', issue.service + ':', issue.message);
      }
    } else {
      console.log('✓ All services healthy');
    }
  }).catch(err => {
    console.error('✗ Health check failed:', err.message);
    process.exit(1);
  });
"

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Health validation works"
else
  echo -e "${RED}✗${NC} Health validation failed"
  exit 1
fi

echo ""
echo -e "${GREEN}🎉 All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Test service restart: jfl services restart"
echo "2. Test health check: jfl services health"
echo "3. Test update flow: jfl update (in a test project)"
