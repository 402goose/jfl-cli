# Platform Integration Guide

This document describes the seamless account linking between jfl-cli and jfl-platform.

## Overview

The jfl-cli now supports **platform authentication** using a device linking flow that integrates with jfl-platform's Dynamic.xyz authentication system.

## How It Works

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   jfl-cli   │────────▶│ jfl-platform │◀────────│   Browser   │
│             │  1. API │              │ 2. Auth │             │
│  Terminal   │  calls  │   Next.js    │  flow   │   Dynamic   │
└─────────────┘         └──────────────┘         └─────────────┘
```

### Flow Steps:

1. **CLI**: User runs `jfl login --platform`
2. **CLI**: Calls `/api/cli/register-device` → Gets device code (e.g., "ABC-123")
3. **CLI**: Opens browser to `/link?code=ABC-123`
4. **Browser**: User authenticates with Dynamic.xyz (email/wallet/social)
5. **Browser**: User enters device code "ABC-123"
6. **Platform**: Links device to authenticated user
7. **CLI**: Polls `/api/cli/device-status` until linked
8. **Platform**: Returns JWT token and user info
9. **CLI**: Saves JWT to `~/.jfl/config.json`
10. **CLI**: All future API calls use `Authorization: Bearer <jwt>`

## Architecture

### CLI Components

#### `src/utils/platform-auth.ts`
Core authentication utility with:
- `registerDevice()` - Register CLI device with platform
- `pollDeviceStatus()` - Wait for user to link device
- `verifyPlatformToken()` - Verify JWT is valid
- `getPlatformAuthHeaders()` - Get auth headers for API calls
- `savePlatformAuth()` - Store JWT and user in config
- `clearPlatformAuth()` - Remove authentication

#### `src/commands/login.ts`
Updated login command with:
- `loginWithPlatform()` - New platform login flow
- Support for multiple auth methods: `platform`, `x402`, `github`
- Backward compatibility with existing auth methods

#### API Integration
All platform API calls now support JWT authentication:
- `src/commands/deploy.ts` - Deploy to platform
- `src/commands/agents.ts` - Manage agents
- `src/commands/feedback.ts` - Submit feedback

### Platform Components (jfl-platform)

#### API Routes
Located in `src/app/api/cli/`:

- **`register-device/route.ts`**
  - POST `/api/cli/register-device`
  - Body: `{ deviceName, machineName }`
  - Returns: `{ deviceId, deviceCode, expiresIn }`
  - Creates pending device with 5-minute expiration

- **`link-device/route.ts`**
  - POST `/api/cli/link-device`
  - Body: `{ deviceCode }`
  - Headers: `Authorization: Bearer <dynamic-jwt>`
  - Links device to authenticated user
  - Returns: `{ success: true }`

- **`device-status/route.ts`**
  - GET `/api/cli/device-status?deviceId=xxx`
  - Returns: `{ status, jwt?, user? }`
  - Status: `pending`, `linked`, or `expired`
  - When linked, includes JWT token and user info

- **`verify/route.ts`**
  - GET `/api/cli/verify`
  - Headers: `Authorization: Bearer <jwt>`
  - Verifies JWT is valid
  - Returns: `{ user }`

#### UI Components

- **`src/app/link/page.tsx`**
  - Device linking page
  - Shows device code input
  - Integrates with Dynamic.xyz widget
  - Pre-fills code from URL parameter

#### Database Schema

```typescript
// cliDevices table
{
  id: string
  userId: string (FK to users)
  deviceCode: string // "ABC-123" format
  deviceName: string // "JFL CLI"
  machineName: string // hostname
  lastUsedAt: Date
  createdAt: Date
}
```

## Development Setup

### 1. Start the Platform

```bash
cd ../jfl-platform
npm run dev
# Runs on http://localhost:3000
```

### 2. Configure CLI Environment

Create `.env.local` in jfl-cli:
```bash
JFL_PLATFORM_URL=http://localhost:3000
```

Or use the test script:
```bash
./test-login.sh
```

### 3. Test the Flow

**Terminal:**
```bash
# Build CLI
npm run build

# Login (interactive terminal required)
./test-login.sh
```

This will:
1. Show the device code (e.g., "ABC-123")
2. Open browser to http://localhost:3000/link?code=ABC-123
3. Wait for you to authenticate and link
4. Save JWT to ~/.jfl/config.json

**Browser:**
1. Sign in with Dynamic.xyz (email/wallet)
2. Enter the device code shown in terminal
3. Click "Link Device"
4. Terminal will show success!

### 4. Verify Authentication

```bash
# Check stored config
cat ~/.jfl/config.json

# Should show:
# {
#   "platformToken": "eyJ...",
#   "platformUser": {
#     "id": "...",
#     "email": "...",
#     "name": "...",
#     "tier": "FREE"
#   },
#   "authMethod": "platform"
# }
```

## Testing API Endpoints

### Register Device
```bash
curl -X POST http://localhost:3000/api/cli/register-device \
  -H "Content-Type: application/json" \
  -d '{"deviceName":"Test CLI","machineName":"test-machine"}'

# Returns:
# {
#   "deviceId": "uuid",
#   "deviceCode": "ABC-123",
#   "expiresIn": 300
# }
```

### Check Device Status
```bash
curl "http://localhost:3000/api/cli/device-status?deviceId=<uuid>"

# Returns (pending):
# { "status": "pending" }

# Returns (linked):
# {
#   "status": "linked",
#   "jwt": "eyJ...",
#   "user": { ... }
# }
```

### Verify Token
```bash
curl http://localhost:3000/api/cli/verify \
  -H "Authorization: Bearer <jwt>"

# Returns:
# {
#   "user": {
#     "id": "...",
#     "email": "...",
#     "tier": "FREE"
#   }
# }
```

## Production Usage

### Environment Variables

**CLI:**
```bash
# Uses production platform by default
JFL_PLATFORM_URL=https://jfl.run
```

**Platform:**
```bash
# JWT signing secret (required)
JWT_SECRET=your-secret-key

# Dynamic.xyz environment ID
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=your-env-id
```

### Login Command

```bash
# Platform account (recommended)
jfl login --platform

# Alternative auth methods
jfl login --x402     # Crypto wallet
jfl login --free     # Trial mode
```

## Security

### JWT Authentication
- Tokens signed with `JWT_SECRET`
- 30-day expiration
- Includes user ID and email
- Verified on every API request

### Device Linking
- Device codes expire in 5 minutes
- One-time use only
- Requires authenticated session to link
- Stored in database with user association

### Client-Side Storage
- JWT stored in `~/.jfl/config.json`
- File permissions: 600 (user read/write only)
- No sensitive data logged

## Migration from Legacy Auth

The CLI supports multiple auth methods simultaneously:

1. **Platform Auth** (new) - JWT from device linking
2. **GitHub OAuth** (legacy) - GitHub token
3. **x402** (wallet) - Crypto wallet signing

Priority order:
1. Check for platform token
2. Fall back to GitHub token
3. Fall back to x402 wallet

All API calls check for platform auth first:
```typescript
const platformAuthHeaders = getPlatformAuthHeaders()
const authHeaders = Object.keys(platformAuthHeaders).length > 0
  ? platformAuthHeaders
  : { Authorization: `Bearer ${legacyToken}` }
```

## Troubleshooting

### "fetch failed" Error
- Ensure jfl-platform is running on port 3000
- Set `JFL_PLATFORM_URL=http://localhost:3000`
- Check firewall/network settings

### "Authentication failed or timed out"
- Device code expires in 5 minutes
- Check browser opened correctly
- Verify Dynamic.xyz configuration
- Check platform database connection

### "Invalid token" Error
- Token may have expired (30 days)
- Run `jfl login --platform --force` to re-authenticate
- Check JWT_SECRET is consistent

### Non-Interactive Terminal
- Platform login requires an interactive terminal (TTY)
- Use `./test-login.sh` script for testing
- Or run directly in a real terminal (not Claude Code)

## API Reference

### Platform Auth Headers

```typescript
// Get auth headers for API calls
import { getPlatformAuthHeaders } from './utils/platform-auth'

const headers = getPlatformAuthHeaders()
// Returns: { Authorization: "Bearer <jwt>" } or {}
```

### Check Authentication

```typescript
import { isPlatformAuthenticated } from './utils/platform-auth'

if (await isPlatformAuthenticated()) {
  // User is authenticated
}
```

### Get User Info

```typescript
import { getPlatformUser } from './utils/platform-auth'

const user = getPlatformUser()
// Returns: { id, email, name?, tier? } or null
```

## Next Steps

1. Test the full flow in your terminal:
   ```bash
   ./test-login.sh
   ```

2. Link your device on the platform

3. Try deploying with platform auth:
   ```bash
   jfl deploy
   ```

4. Check the dashboard:
   ```bash
   open http://localhost:3000/dashboard
   ```

## Resources

- [Dynamic.xyz Docs](https://docs.dynamic.xyz/)
- [JWT.io](https://jwt.io/)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)
