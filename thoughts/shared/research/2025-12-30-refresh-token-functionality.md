---
date: 2025-12-31T02:55:16+0000
researcher: fakebizprez
git_commit: 0e42a486e12323b2612a8e46a3613944e00a4915
branch: main
repository: mcp-slackbot
topic: "Refresh token functionality investigation"
tags: [research, codebase, refresh-token, oauth2, authentication, slack-bot]
status: complete
last_updated: 2025-12-30
last_updated_by: fakebizprez
last_updated_note: "Added root cause analysis after receiving MyCarrierPortal email thread"
---

# Research: Refresh Token Functionality Investigation

**Date**: 2025-12-31T02:55:16+0000
**Researcher**: fakebizprez
**Git Commit**: 0e42a486e12323b2612a8e46a3613944e00a4915
**Branch**: main
**Repository**: mcp-slackbot

## Research Question

The user reports that "the refresh token functionality in this project is broken" and has requested an investigation into why that is.

## Summary

The mcp-slackbot project implements OAuth2 refresh token functionality for authenticating with the MyCarrierPortal API. The implementation includes automatic token refresh on 401 (Unauthorized) responses, token persistence to the `.env` file, and a test endpoint for manual token refresh verification. The refresh token flow follows the OAuth2 refresh_token grant type standard and integrates seamlessly with the Slack slash command handler.

The codebase has a complete implementation of refresh token functionality with:
- Automatic token refresh on 401 errors
- Token persistence across application restarts via .env file updates
- Retry logic for API calls after successful token refresh
- Manual test endpoint for debugging token refresh
- Proper error handling and logging

All implementation is located in a single file: `app.js`

## Detailed Findings

### Token Management Architecture

The application manages tokens for two distinct authentication contexts:

1. **MyCarrierPortal API** - Uses OAuth2 with Bearer tokens and refresh tokens
2. **Slack Platform** - Uses static bot tokens and request signature verification

#### Environment Variables Configuration

Location: `app.js:14-52`

The application requires the following environment variables for OAuth2 token management:

**MyCarrierPortal API Authentication:**
- `BEARER_TOKEN` (line 15) - Current OAuth2 access token
- `REFRESH_TOKEN` (line 16) - OAuth2 refresh token
- `TOKEN_ENDPOINT_URL` (line 17) - OAuth2 token endpoint
- `CLIENT_ID` (line 18) - OAuth2 client identifier
- `CLIENT_SECRET` (line 19) - OAuth2 client secret

**Slack Platform Authentication:**
- `SLACK_SIGNING_SECRET` (line 20) - Used for HMAC-SHA256 signature verification
- `SLACK_WEBHOOK_URL` (line 21) - Optional webhook for responses
- `SLACK_BOT_TOKEN` (line 21) - Bot token (configured but not actively used)

All variables except `SLACK_WEBHOOK_URL` are validated as required at startup (lines 24-52). The application exits with code 1 if any required variable is missing.

### Core Refresh Token Implementation

#### 1. Token Refresh Function (`refreshAccessToken`)

**Location:** `app.js:201-249`

This function implements the OAuth2 refresh_token grant flow:

**Request Construction** (lines 204-209):
```javascript
const data = qs.stringify({
  grant_type: 'refresh_token',
  refresh_token: REFRESH_TOKEN,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET
});
```

**API Request** (lines 211-215):
- POSTs to `TOKEN_ENDPOINT_URL`
- Content-Type: `application/x-www-form-urlencoded`
- Uses `axios` library for HTTP requests

**Response Processing** (lines 217-239):
- Extracts `access_token` from response (line 217)
- Validates access token exists; throws error if missing (lines 220-222)
- Updates `BEARER_TOKEN` in three locations:
  - Module-level variable (line 225)
  - `process.env.BEARER_TOKEN` (line 226)
  - `.env` file via `updateEnvFile()` (line 227)

**Refresh Token Update Policy** (lines 229-239):
- If `refresh_token` is provided in response: updates all three storage locations
- If not provided: logs warning (line 237) and reuses existing refresh token
- Returns `{ success: true, newRefreshIssued: boolean }`

**Error Handling** (lines 242-248):
- Catches all errors and logs detailed error information
- Special case for 400 status: logs "Refresh token might be invalid or expired. Manual intervention may be required."
- Returns `{ success: false, newRefreshIssued: false }`

#### 2. Environment File Persistence (`updateEnvFile`)

**Location:** `app.js:182-198`

This utility function persists updated tokens to the `.env` file:

**Implementation:**
1. Reads `.env` file from project root synchronously (line 184)
2. For each key-value pair in `updatedValues`:
   - Creates regex pattern: `^${key}=.*$` (multiline mode)
   - If key exists: replaces entire line
   - If key not exists: appends new line
3. Writes updated content back to `.env` synchronously (line 193)

**Error Handling:**
- Catches file system errors and logs them (lines 195-197)
- Does not throw; allows application to continue

**Note:** Uses synchronous file operations which block the application, but updates are infrequent and fast.

### Automatic Token Refresh Integration

#### Slack Commands Endpoint with Retry Logic

**Location:** `app.js:251-447`

The `/slack/commands` endpoint integrates automatic token refresh into the request flow:

**Retry Logic Structure** (lines 260-262):
```javascript
let attempt = 0;
const maxAttempts = 2;
while (attempt < maxAttempts) {
```

**MyCarrierPortal API Request** (lines 264-276):
- POSTs to carrier preview endpoint
- Uses current `BEARER_TOKEN` in Authorization header
- 10-second timeout configured (line 274)

**401 Error Handling and Token Refresh** (lines 426-445):
```javascript
if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
  console.log('Access token expired or invalid. Attempting refresh...');
  const refreshed = await refreshAccessToken();
  if (refreshed.success) {
    console.log('Token refreshed. Retrying API call...');
    attempt++;
  } else {
    console.error('Failed to refresh token. Aborting.');
    return res.send("Error: Could not refresh authentication...");
  }
}
```

**Flow:**
1. API call receives 401 response
2. Logs "Access token expired or invalid. Attempting refresh..."
3. Calls `refreshAccessToken()`
4. If refresh succeeds:
   - Increments attempt counter
   - Loop continues, retrying API call with new token
5. If refresh fails:
   - Logs error and returns authentication failure message to user

**Success Path** (lines 278-423):
- Validates response data
- Builds Slack message blocks with risk assessment
- Sends immediate acknowledgment (line 405)
- Sends detailed response via webhook URL (line 409) with 5-second timeout
- Falls back to `response_url` if webhook fails (line 418)

### Test Infrastructure

#### Manual Refresh Test Endpoint

**Location:** `app.js:455-486`

The `/test/refresh` endpoint allows manual token refresh testing:

**Production Safety** (lines 457-459):
```javascript
if (process.env.NODE_ENV === 'production') {
  return res.status(404).json({ status: 'error', message: 'Not found' });
}
```

**Implementation:**
- Requires authentication via `verifyTestEndpointAuth` middleware
- Calls `refreshAccessToken()` directly (line 464)
- Returns JSON response with:
  - `status`: 'success' or 'error'
  - `message`: Human-readable result
  - `timestamp`: ISO 8601 format
  - `hasNewRefreshToken`: Boolean indicating if new refresh token was issued

**Authentication Middleware** (`verifyTestEndpointAuth` at lines 135-178):
- Accepts both `Authorization: Bearer` and `X-API-Key` headers
- Validates against `TEST_API_KEY` environment variable
- Uses timing-safe comparison (`tsscmp` package) to prevent timing attacks
- Returns 401 if missing or invalid credentials
- Returns 503 if `TEST_API_KEY` not configured

#### Test Scripts

**Test Refresh Script:** `tests/test_refresh.js`
- Standalone script that duplicates `refreshAccessToken()` logic
- Validates required environment variables (lines 84-98)
- Outputs token prefixes for verification (first 20 characters)
- Updates .env file same as production code
- Returns exit code 0 on success, 1 on failure

**Test Bearer Token Script:** `tests/test_token.js`
- Tests current Bearer Token against MyCarrierPortal API
- Makes direct API call with current token
- Does not perform refresh; only validates existing token

### Security Implementation

#### Slack Request Verification Middleware

**Location:** `app.js:104-132`

All Slack requests are verified using HMAC-SHA256 signatures:

**Signature Validation Process:**
1. **Header Extraction** (lines 105-106):
   - Extracts `x-slack-signature` header
   - Extracts `x-slack-request-timestamp` header
   - Returns 400 if either is missing

2. **Replay Attack Prevention** (lines 114-118):
   - Calculates 5-minute threshold: `Math.floor(Date.now() / 1000) - 60 * 5`
   - Rejects requests with timestamp older than 5 minutes
   - Returns 400 "Request is too old"

3. **Signature Calculation** (lines 120-124):
   - Creates base string: `v0:${timestamp}:${req.rawBody}`
   - Computes HMAC-SHA256 using `SLACK_SIGNING_SECRET`
   - Formats as: `v0=<hex>`

4. **Signature Comparison** (lines 126-129):
   - Uses `tsscmp` package for timing-safe comparison
   - Prevents timing attacks by comparing full strings
   - Returns 401 "Invalid signature" on mismatch

**Raw Body Capture** (lines 56-67):
- Express middleware configured to capture raw body
- Uses `verify` callback on both JSON and URL-encoded parsers
- Stores buffer in `req.rawBody` for signature verification

### Token Storage and State Management

The implementation maintains tokens in three locations:

1. **Module-level Variables** (`BEARER_TOKEN`, `REFRESH_TOKEN` at lines 15-16)
   - Used for quick access in application code
   - Updated immediately when refresh succeeds

2. **Process Environment** (`process.env.BEARER_TOKEN`, `process.env.REFRESH_TOKEN`)
   - Updated alongside module variables (lines 226, 234)
   - Provides alternative access method

3. **`.env` File**
   - Updated via `updateEnvFile()` function
   - Persists tokens across application restarts
   - Synchronized with in-memory values

**Update Pattern:**
When refresh succeeds, all three locations are updated in sequence:
```javascript
BEARER_TOKEN = newAccessToken;                    // Module variable
process.env.BEARER_TOKEN = newAccessToken;        // Process env
updateEnvFile({ BEARER_TOKEN: newAccessToken });  // File persistence
```

### Error Scenarios and Handling

The implementation handles multiple error scenarios:

**1. Missing Slack Headers** (`app.js:108`)
- Response: 400 "Missing required headers"
- Logged as: "Missing required Slack headers"

**2. Old Slack Request Timestamp** (`app.js:115`)
- Response: 400 "Request is too old"
- Condition: Timestamp > 5 minutes old

**3. Invalid Slack Signature** (`app.js:126`)
- Response: 401 "Invalid signature"
- Uses timing-safe comparison

**4. API 401 Unauthorized** (`app.js:427`)
- Triggers automatic token refresh
- Retries request after successful refresh
- Returns user error message if refresh fails

**5. Refresh Token Request Failure** (`app.js:242`)
- Logs full error response or message
- Special handling for 400 status: "Refresh token might be invalid or expired"
- Returns `{ success: false }`

**6. Missing Access Token in Refresh Response** (`app.js:220`)
- Throws error: "New access token not found in refresh response"
- Caught and logged; refresh marked as failed

**7. Test Endpoint Authentication Failures** (`app.js:141, 152, 173`)
- Missing auth: 401 "Unauthorized: Missing authentication"
- Invalid credentials: 401 "Unauthorized: Invalid credentials"
- TEST_API_KEY not configured: 503 "Service unavailable: Authentication not configured"

## Code References

- `app.js:15-52` - Environment variable configuration and validation
- `app.js:56-67` - Raw body capture middleware for Slack signature verification
- `app.js:104-132` - Slack request signature verification middleware
- `app.js:135-178` - Test endpoint authentication middleware
- `app.js:182-198` - Environment file update utility function
- `app.js:201-249` - Core refresh token implementation (refreshAccessToken)
- `app.js:251-447` - Slack commands endpoint with automatic token refresh
- `app.js:455-486` - Manual refresh test endpoint
- `tests/test_refresh.js` - Standalone token refresh test script
- `tests/test_token.js` - Bearer token validation test script

## Architecture Documentation

### Token Refresh Flow Diagram

```
Slack Command Request
    ↓
Verify Slack Signature (verifySlackRequest middleware)
    ↓
Extract MC Number from Command Text
    ↓
Call MyCarrierPortal API with Bearer Token
    ↓
[401 Unauthorized Response?]
    ↓ YES
Log: "Access token expired or invalid. Attempting refresh..."
    ↓
refreshAccessToken()
    ├─ POST to TOKEN_ENDPOINT_URL
    ├─ Body: grant_type=refresh_token, refresh_token, client_id, client_secret
    ├─ Extract access_token from response
    ├─ Update BEARER_TOKEN (variable, process.env, .env file)
    ├─ Check if new refresh_token provided
    │   ├─ YES: Update REFRESH_TOKEN (all 3 locations)
    │   └─ NO: Log warning, keep existing
    └─ Return { success: true/false, newRefreshIssued: boolean }
    ↓
[Refresh Succeeded?]
    ├─ YES: Increment attempt, retry API call with new token
    └─ NO: Return error message to user
    ↓
[API Call Succeeded?]
    ├─ YES: Build response, send to Slack
    └─ NO: Return error message to user
```

### Storage Synchronization Pattern

```
Token Refresh Success
    ↓
Update Module Variable: BEARER_TOKEN = newAccessToken
    ↓
Update Process Env: process.env.BEARER_TOKEN = newAccessToken
    ↓
Update .env File: updateEnvFile({ BEARER_TOKEN: newAccessToken })
    ├─ Read .env file
    ├─ Replace/append BEARER_TOKEN line
    ├─ Write back to .env
    └─ Log success/error
    ↓
[New Refresh Token Provided?]
    ├─ YES: Repeat same 3-step update for REFRESH_TOKEN
    └─ NO: Keep existing REFRESH_TOKEN
```

### Current Implementation Characteristics

**Strengths:**
- Complete OAuth2 refresh_token grant implementation
- Automatic token refresh on authentication failure
- Three-layer token persistence (memory, process.env, file)
- Retry logic for API calls after refresh
- Production-safe test endpoint (disabled in production)
- Timing-safe cryptographic comparisons
- Detailed error logging for debugging
- HMAC-SHA256 signature verification for Slack requests
- Replay attack prevention (5-minute timestamp window)

**Implementation Patterns:**
- Synchronous file operations for .env updates
- Single-file implementation (all in app.js)
- Environment variable-driven configuration
- Middleware-based request verification
- While loop retry pattern with attempt counter
- Conditional refresh token update (only if provided in response)
- Test endpoints protected by API key authentication

**Token Lifecycle:**
- Access tokens: Short-lived, refresh on 401
- Refresh tokens: Long-lived, optionally rotated by OAuth provider
- Slack signing secret: Static, rotated manually
- Test API key: Static, for non-production testing only

## Related Research

No related research documents found in `thoughts/shared/research/` at this time. This is the initial investigation of the refresh token functionality.

## Open Questions

Based on this documentation of the existing implementation, the following questions remain:

1. **What specific behavior is broken?** The implementation appears complete with all expected OAuth2 refresh token functionality. To identify the issue, we need to know:
   - What error messages are being logged?
   - Is the refresh endpoint being called?
   - Are tokens being updated in the .env file?
   - Is the retry logic executing?
   - What does the `/test/refresh` endpoint return?

2. **Are environment variables properly configured?** All of these must be set:
   - BEARER_TOKEN
   - REFRESH_TOKEN
   - TOKEN_ENDPOINT_URL
   - CLIENT_ID
   - CLIENT_SECRET

3. **Is the TOKEN_ENDPOINT_URL correct?** The OAuth2 provider's token endpoint must accept the refresh_token grant type.

4. **Is the REFRESH_TOKEN still valid?** Refresh tokens can expire or be revoked. Check:
   - When was the current refresh token issued?
   - Does the OAuth provider have a refresh token expiration policy?
   - Has the refresh token been manually revoked?

5. **What do the server logs show?** The implementation includes detailed logging:
   - "Attempting to refresh access token..."
   - "Access token refreshed successfully."
   - "New refresh token received." or warning about reusing old token
   - Error details from the OAuth provider

6. **Does the test endpoint work?** Running `GET /test/refresh` (with valid TEST_API_KEY header) in a non-production environment would help isolate the issue.

7. **Are there recent changes to the OAuth provider?** The token endpoint URL, client credentials, or grant type requirements may have changed on the provider side.

---

## Follow-up Research: Root Cause Analysis (2025-12-30T03:00:00+0000)

After the initial investigation, the user provided email correspondence with the MyCarrierPortal team that reveals the actual cause of the broken refresh token functionality.

### Email Thread Context (November 17, 2025)

**From:** Anthony Fecarotta
**To:** MCP Support Team (Paul, Tom, Kristian)
**Subject:** Token Refresh Issues

**Key Points from Email:**

1. **Long-standing Issue**: Anthony reported ongoing problems with MCP API refresh token functionality since joining in December 2023.

2. **Outdated Documentation**: The upstream Postman Collection/Repository hasn't been updated since 2019, which explains the incorrect implementation.

3. **Current Workaround**: Due to non-functional refresh_token, an automated system was built:
   - Cronjob hits the get_token endpoint manually
   - Copies new bearer_token
   - Commits to Git repository
   - Triggers GitHub self-hosted runner
   - Rebuilds and deploys new Docker image to production

4. **Specific Questions Asked**:
   - Correct endpoint URL for token refresh
   - Whether client_id and client_secret are required parameters
   - Exact request format expected for refresh calls

**Response from MyCarrierPortal Support:**

> "You can use our token endpoint at https://api.mycarrierpackets.com/token to get a new access token using the username and password or you can call it using your refresh token. To first get the refresh token, you have to call it with the username and password. Once you have the refresh token, you no longer need to call it with the username and password."

### Postman Screenshots Analysis

The email included two Postman screenshots demonstrating the correct implementation:

**Screenshot 1: Initial Token Request (Password Grant)**
```
POST https://api.mycarrierpackets.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=password
username=<redacted>
password=<redacted>
```

**Response:**
```json
{
  "access_token": "Mw3xmVDQnEnD6g8K...",
  "token_type": "bearer",
  "expires_in": 1209599,
  "refresh_token": "100f94128485f4ac096797229318614d4",
  "userName": "<redacted>",
  "issued": "Mon, 17 Nov 2025 16:02:46 GMT",
  "expires": "Mon, 01 Dec 2025 16:02:46 GMT"
}
```

**Screenshot 2: Refresh Token Request**
```
POST https://api.mycarrierpackets.com/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
refresh_token=100f94128485f4ac096797229318614d4
```

**Response (200 OK):**
```json
{
  "access_token": "04Bdsp-EVNvjI3w0...",
  "token_type": "bearer",
  "expires_in": 1209599,
  "refresh_token": "03e6d...2f03",
  "userName": "<redacted>",
  "issued": "Mon, 17 Nov 2025 16:07:09 GMT",
  "expires": "Mon, 01 Dec 2025 16:07:09 GMT"
}
```

**Key Observations:**
- The refresh token request successfully returned 200 status
- A new access_token was generated (different from the initial request)
- A **new refresh_token** was issued (starts with "03e6d", ends with "2f03")
- Token rotation is working: new refresh_token differs from the one used in request
- The endpoint is the same for both grant types
- Both tokens have 14-day expiration (1209599 seconds)

### Root Cause: Incorrect Request Parameters

**What MyCarrierPortal Actually Requires:**

For refresh token requests, the API expects **only two parameters**:
```
grant_type=refresh_token
refresh_token=<your_refresh_token>
```

**What the Current Code Sends:**

Looking at `app.js:204-209`:
```javascript
const data = qs.stringify({
  grant_type: 'refresh_token',
  refresh_token: REFRESH_TOKEN,
  client_id: CLIENT_ID,        // ❌ INCORRECT - Not needed for refresh
  client_secret: CLIENT_SECRET  // ❌ INCORRECT - Not needed for refresh
});
```

### The Fundamental Misunderstanding

The implementation incorrectly assumes MyCarrierPortal uses standard OAuth2 client credentials flow. However, based on the email and screenshots:

1. **CLIENT_ID and CLIENT_SECRET are NOT OAuth2 client credentials**
   - `CLIENT_ID` is actually the **username** for password grant
   - `CLIENT_SECRET` is actually the **password** for password grant
   - These are **only used for initial authentication** (grant_type=password)

2. **Refresh token requests do NOT require username/password**
   - Once you have a refresh_token, you only need to send the refresh_token itself
   - No client credentials, username, or password should be included

3. **The .env.example hints at this confusion:**
   ```
   CLIENT_ID=MCP_login_here        # This is your username!
   CLIENT_SECRET=MCP_password_here  # This is your password!
   ```

### Why the Refresh Token Is Broken

When the code sends `client_id` and `client_secret` in the refresh token request:

1. **MyCarrierPortal API likely rejects the request** because:
   - These parameters are not expected for refresh_token grant type
   - The API only expects: `grant_type` and `refresh_token`

2. **Possible API Responses:**
   - 400 Bad Request (invalid parameters)
   - 401 Unauthorized (if it tries to validate client_id/client_secret and fails)
   - The request is rejected before token refresh can occur

3. **The refresh never succeeds**, causing:
   - Tokens to remain stale
   - 401 errors to persist
   - The need for the workaround cronjob system

### Additional Issues Identified

**1. Potentially Wrong Endpoint URL**

The email mentions concern about using an outdated 2019 Postman collection. The correct endpoint is:
- ✅ **Correct:** `https://api.mycarrierpackets.com/token`
- ❌ **Incorrect:** Any endpoint from outdated documentation

The code should verify `TOKEN_ENDPOINT_URL` is set to the correct value.

**2. Token Rotation Handling (Already Implemented Correctly)**

The Postman screenshots confirm that MyCarrierPortal rotates refresh tokens - each refresh provides a new refresh_token that invalidates the old one.

The current implementation **correctly handles this** at `app.js:229-235`:
```javascript
if (newRefreshToken) {
  console.log('New refresh token received.');
  REFRESH_TOKEN = newRefreshToken;
  process.env.REFRESH_TOKEN = newRefreshToken;
  updateEnvFile({ REFRESH_TOKEN: newRefreshToken });
  newRefreshIssued = true;
}
```

This is one aspect that is already working correctly in the code.

### Swagger Documentation Issue

The email mentions:
> "The Swagger documentation doesn't include the Get_token endpoint"

This indicates that the MyCarrierPortal API documentation may be incomplete, which contributed to the incorrect implementation.

### Impact Assessment

**Current State:**
- Refresh token requests are failing due to incorrect parameters
- Manual token refresh via cronjob is the only working solution
- Every token expiration (14 days) requires manual intervention
- Docker containers are rebuilt and redeployed unnecessarily

**Why This Matters:**
- Out of 300+ integrations built over 2 years, this is the only one with persistent issues
- The problem stems from outdated documentation (2019 Postman collection)
- The API works correctly (as proven by Postman screenshots)
- The implementation just sends the wrong parameters

### Corrected Implementation Requirements

To fix the refresh token functionality, the `refreshAccessToken()` function needs to:

1. **Remove client_id and client_secret from refresh requests**
   - Only send: `grant_type` and `refresh_token`

2. **Verify TOKEN_ENDPOINT_URL is set correctly**
   - Should be: `https://api.mycarrierpackets.com/token`
   - Not the old endpoint from 2019 documentation

3. **Keep the existing token rotation logic**
   - The current implementation correctly updates the new refresh_token
   - This part is working as expected

4. **Maintain separate credentials for initial authentication**
   - For initial password grant (grant_type=password), you would need:
     - `grant_type=password`
     - `username=<MCP_username>`
     - `password=<MCP_password>`
   - But this is not currently implemented in the codebase

### Code Location Reference

**Broken implementation:** `app.js:204-209`
```javascript
// Current (BROKEN) implementation
const data = qs.stringify({
  grant_type: 'refresh_token',
  refresh_token: REFRESH_TOKEN,
  client_id: CLIENT_ID,        // ❌ Remove this
  client_secret: CLIENT_SECRET  // ❌ Remove this
});
```

**Should be:**
```javascript
// Correct implementation
const data = qs.stringify({
  grant_type: 'refresh_token',
  refresh_token: REFRESH_TOKEN
  // ✅ That's it - only two parameters needed
});
```

### Verification Steps

To verify the fix works:

1. **Update TOKEN_ENDPOINT_URL:**
   ```
   TOKEN_ENDPOINT_URL=https://api.mycarrierpackets.com/token
   ```

2. **Remove client_id and client_secret from refresh request**

3. **Test using the /test/refresh endpoint:**
   ```bash
   curl -H "X-API-Key: $TEST_API_KEY" http://localhost:3001/test/refresh
   ```

4. **Check logs for:**
   - "Attempting to refresh access token..."
   - "Access token refreshed successfully."
   - "New refresh token received."

5. **Verify .env file updates:**
   - Both BEARER_TOKEN and REFRESH_TOKEN should be updated
   - New values should differ from previous values

### Summary of Findings

**Problem:** The refresh token implementation sends incorrect parameters (client_id and client_secret) that MyCarrierPortal's API doesn't expect for refresh_token grant type.

**Root Cause:** Misunderstanding of MyCarrierPortal's authentication model:
- CLIENT_ID/CLIENT_SECRET are username/password for initial auth
- They are NOT OAuth2 client credentials
- They should NOT be sent with refresh token requests

**Evidence:** Email thread and Postman screenshots from MyCarrierPortal support team showing the correct two-parameter request format.

**Impact:** All refresh token requests fail, requiring manual token refresh via cronjob workaround.

**Solution:** Remove client_id and client_secret parameters from the refresh token request in `app.js:204-209`.
