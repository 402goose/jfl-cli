#!/bin/bash
# Test script for platform login

# Load environment variables
export JFL_PLATFORM_URL=http://localhost:3000

# Run the login command
node dist/index.js login --platform
