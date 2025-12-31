---
date: 2025-12-31T03:37:42+0000
researcher: Claude
git_commit: 0e42a48
branch: main
repository: mcp-slackbot
topic: "Refresh Token Fix Implementation"
tags: [implementation, hotfix, refresh-token, oauth2, mycarrierportal]
status: in_progress
last_updated: 2025-12-30
last_updated_by: Claude
type: implementation_strategy
---

# Handoff: Fix broken refresh token functionality

## Task(s)

| Task | Status |
|------|--------|
| Investigate why refresh token is broken | completed |
| Document root cause with evidence | completed |
| Create hotfix branch | planned |
| Implement fix in app.js | planned |
| Implement fix in tests/test_refresh.js | planned |
| Test fix in production Docker container | planned |

## Critical References

- `thoughts/shared/research/2025-12-30-refresh-token-functionality.md` - Comprehensive research document with root cause analysis
- Email thread from MyCarrierPortal support (November 17, 2025) showing correct API format

## Recent Changes

- `thoughts/shared/research/2025-12-30-refresh-token-functionality.md:1-738` - Created research document with full investigation

## Learnings

### Root Cause (CONFIRMED)
The refresh token implementation sends **incorrect parameters**. We confirmed this with live production logs:

```
Error refreshing access token: {
  "error": "invalid_grant"
}
```

### What's Wrong

**Current broken code** at `app.js:204-209`:
```javascript
const data = qs.stringify({
  grant_type: 'refresh_token',
  refresh_token: REFRESH_TOKEN,
  client_id: CLIENT_ID,        // ❌ CAUSES invalid_grant ERROR
  client_secret: CLIENT_SECRET  // ❌ CAUSES invalid_grant ERROR
});
```

**MyCarrierPortal only expects TWO parameters** for refresh:
```
grant_type=refresh_token
refresh_token=<token>
```

### Key Insight
- `CLIENT_ID` and `CLIENT_SECRET` are NOT OAuth2 client credentials
- They are the **username and password** for initial password grant only
- They should NOT be sent with refresh_token grant type
- The .env.example even hints at this: `CLIENT_ID=MCP_login_here`

### Evidence
1. Email from MyCarrierPortal support showing correct 2-parameter format
2. Postman screenshots showing successful refresh with only `grant_type` + `refresh_token`
3. Live production test returning `{"error": "invalid_grant"}`

## Artifacts

- `/Users/fakebizprez/developer/repositories/mcp-slackbot/thoughts/shared/research/2025-12-30-refresh-token-functionality.md`

## Action Items & Next Steps

1. **Create hotfix branch** (user requested this before implementing):
   ```bash
   git checkout -b hotfix/refresh-token-fix
   ```

2. **Fix app.js:204-209** - Remove client_id and client_secret:
   ```javascript
   const data = qs.stringify({
     grant_type: 'refresh_token',
     refresh_token: REFRESH_TOKEN
   });
   ```

3. **Fix tests/test_refresh.js:38-43** - Same change (duplicate code)

4. **Test the fix** on production Docker container:
   ```bash
   docker exec -it dd9b8b919b87 node tests/test_refresh.js
   ```

   Expected output should show:
   - "Access token refreshed successfully."
   - "New refresh token received."

5. **Rebuild and deploy** Docker image to production

6. **Optional cleanup**: Consider whether CLIENT_ID and CLIENT_SECRET env vars are still needed (they're only used for initial password grant, which isn't implemented)

## Other Notes

- Production Docker container ID: `dd9b8b919b87`
- NODE_ENV is set to `production` in the container
- Current BEARER_TOKEN is still valid (API calls succeed on attempt 1)
- The /test/refresh endpoint returns 404 in production - use the test script instead
- Token rotation logic (lines 229-235) is already correct - no changes needed there
- Correct TOKEN_ENDPOINT_URL: `https://api.mycarrierpackets.com/token`
