# Add Health Check Endpoint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/health` endpoint on port 3001 to fix the deploy workflow verification step.

**Architecture:** Use Bolt SDK's `customRoutes` feature to add a minimal HTTP endpoint alongside Socket Mode. The health endpoint will return JSON with status information including database connectivity.

**Tech Stack:** @slack/bolt customRoutes, existing db.js for connectivity check

---

## Background

The deploy workflow at `.github/workflows/deploy.yml:89-95` expects a health endpoint at `http://localhost:3001/health`, but the current `app.js` only uses Socket Mode with no HTTP server. This causes deployments to fail even when the bot is working correctly.

## Task 1: Add Health Endpoint to Bolt App

**Files:**
- Modify: `app.js:52-57` (App initialization)
- Modify: `app.js:364-369` (startServer function)

**Step 1: Update the App initialization to include customRoutes**

Replace lines 52-57:
```javascript
const slackApp = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true
});
```

With:
```javascript
// Track database availability
let dbAvailable = false;

const slackApp = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  customRoutes: [
    {
      path: '/health',
      method: ['GET'],
      handler: (req, res) => {
        const health = {
          status: 'ok',
          timestamp: new Date().toISOString(),
          socketMode: true,
          database: dbAvailable ? 'connected' : 'unavailable'
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(health));
      }
    }
  ]
});
```

**Step 2: Update loadTokens to set dbAvailable flag**

Modify the `loadTokens()` function (around line 60-77) to set `dbAvailable = true` on success:

```javascript
async function loadTokens() {
  try {
    await initDb();
    const dbTokens = await getTokens();
    if (dbTokens) {
      logger.info('Loaded tokens from database');
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      logger.info('No tokens in database, saving from environment');
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
    dbAvailable = true;
  } catch (error) {
    logger.error({ err: error }, 'Error loading tokens from database');
    logger.warn('Falling back to environment variables');
    dbAvailable = false;
  }
}
```

**Step 3: Update startServer to log the HTTP port**

Replace lines 364-369:
```javascript
async function startServer() {
  await loadTokens();
  await slackApp.start();
  logger.info('Slack Bolt app is running in Socket Mode');
}
```

With:
```javascript
async function startServer() {
  await loadTokens();
  await slackApp.start(3001);
  logger.info('Slack Bolt app is running in Socket Mode with health endpoint on port 3001');
}
```

**Step 4: Run the app locally to verify**

```bash
bun run start
```

Expected: App starts, logs show port 3001

**Step 5: Test the health endpoint**

```bash
curl http://localhost:3001/health
```

Expected output:
```json
{"status":"ok","timestamp":"2026-01-17T...","socketMode":true,"database":"connected"}
```

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat: add /health endpoint via customRoutes for deploy verification"
```

---

## Task 2: Verify Deploy Workflow Works

**Files:**
- Review: `.github/workflows/deploy.yml` (no changes needed)

**Step 1: Review the deploy workflow health check**

The workflow at lines 87-95 does:
```yaml
# Test the health endpoint
echo "Testing health endpoint..."
if curl -f http://localhost:3001/health; then
  echo "✅ Health check passed!"
else
  echo "❌ Health check failed!"
  docker compose logs
  exit 1
fi
```

This should now work with our new endpoint.

**Step 2: Build and test with Docker locally**

```bash
docker compose build mcpslackbot
docker compose up -d
sleep 5
curl http://localhost:3001/health
docker compose down
```

Expected: Health check returns JSON response

**Step 3: Commit if any Docker changes needed**

No changes expected, but verify.

---

## Verification

1. **Local test:** `bun run start` then `curl http://localhost:3001/health`
2. **Docker test:** `docker compose up -d --build` then `curl http://localhost:3001/health`
3. **Deploy workflow:** Push to `socket-mode` or run the workflow manually from `socket-mode` to verify the full pipeline

## Summary of Changes

| File | Change |
|------|--------|
| `app.js` | Add `customRoutes` with `/health` endpoint, add `dbAvailable` flag, pass port to `start()` |

Total: 1 file modified, ~25 lines added
