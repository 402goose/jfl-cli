# Fixes Applied

## Issue 1: Device Code Expiring Too Fast ✅

**Problem:** The code appeared to expire instantly because the CLI kept polling a device-status endpoint that didn't check expiration.

**Fix:** Updated `/api/cli/device-status` to:
- Check if the device code has expired (>5 minutes)
- Return `{ status: "expired" }` when expired
- CLI will now show proper expiration message instead of timing out

**Files Changed:**
- `../jfl-platform/src/app/api/cli/device-status/route.ts`

## Issue 2: GitHub Login Showing ⚠️

**Problem:** Dynamic.xyz widget is showing GitHub as a login option.

**Partial Fix:** Simplified Dynamic provider config to use basic settings.

**Full Fix Required:**
The login providers (email, wallet, GitHub, Google) are configured in your **Dynamic.xyz Dashboard**, not in code.

### To Remove GitHub Login:

1. Go to https://app.dynamic.xyz/
2. Select your environment (ID: `c4755a26-3419-45d7-907e-c4d4c1cd98b8`)
3. Navigate to **Settings** → **SDK & Auth**
4. Under **Social Providers**, disable:
   - GitHub
   - Google (if you don't want it)
5. Keep enabled:
   - Email
   - Wallet providers (MetaMask, Coinbase, WalletConnect, etc.)
6. Save changes

The Dynamic widget will then only show email and wallet options!

**Files Changed:**
- `../jfl-platform/src/components/dynamic-provider.tsx`

## Issue 3: Database Schema Missing Column ✅

**Problem:** The `accounts` table was missing the `user_id` column, causing account creation to fail.

**Fix:** Added the column:
```sql
ALTER TABLE accounts
ADD COLUMN user_id text REFERENCES "User"(id) ON DELETE CASCADE;
```

**Files Changed:**
- `../jfl-platform/src/app/api/account/route.ts` (better error handling)

## Testing the Fixes

### 1. Test Code Expiration

```bash
cd ~/code/goose/jfl/jfl-cli
./test-login.sh
```

Now if you wait more than 5 minutes, you'll see:
```
❌ Authentication failed or timed out
```

Instead of it polling forever!

### 2. Test Account Creation

When you authenticate and link a device, it should now:
1. Create your User record ✅
2. Create your account record ✅
3. Return JWT token ✅
4. Show success! ✅

### 3. Check Login Providers

Open http://localhost:3000/link in your browser and check what login options show:
- If GitHub/Google still appear → Configure Dynamic.xyz dashboard (see above)
- If only Email/Wallet appear → Perfect! ✅

## New Expiration Behavior

**Before:**
- CLI polls forever, user gets confused
- Eventually times out after 5 minutes with generic error

**After:**
- CLI polls for up to 5 minutes
- If code expires, server returns `{ status: "expired" }`
- CLI shows clear message: "Device code expired. Please try again."
- User can immediately retry with a fresh code

## Summary

✅ **Fixed:** Code expiration checking in device-status endpoint
✅ **Fixed:** Database schema (added user_id column)
✅ **Fixed:** Better error handling in account creation
⚠️ **Action Required:** Configure Dynamic.xyz dashboard to remove GitHub/Google providers

Try the login flow again:
```bash
./test-login.sh
```

Should work smoothly now! 🚀
