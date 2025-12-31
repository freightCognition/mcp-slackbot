---
date: 2025-12-31
author: Claude
status: ready
ticket: N/A
title: "Add libSQL Token Persistence"
---

# Implementation Plan: libSQL Token Persistence

## Overview

Add token persistence using libSQL (sqld) to ensure OAuth refresh tokens survive container restarts. Currently, tokens are only stored in memory and environment variables, causing issues when MCP rotates refresh tokens.

## Context

- **Problem**: Refresh tokens are rotated by MyCarrierPortal API. New tokens only exist in memory. Container restart = lost tokens = auth failure.
- **Solution**: Store tokens in libSQL database with Docker volume persistence.
- **Why libSQL**: SQLite compatibility + high availability potential + Turso cloud option for future.

## Prerequisites

- [x] Refresh token fix implemented (removed client_id/client_secret)
- [x] Fresh tokens obtained and working
- [ ] This plan approved

---

## Phase 1: Add libSQL Container

### Changes

**File: `docker compose.yml`**

```yaml
services:
  libsql:
    image: ghcr.io/tursodatabase/libsql-server:latest
    platform: linux/amd64
    ports:
      - "8080:8080"
    volumes:
      - libsql-data:/var/lib/sqld
    environment:
      - SQLD_HTTP_LISTEN_ADDR=0.0.0.0:8080
    restart: unless-stopped

  mcpslackbot:
    image: mcpslackbot
    build:
      context: .
      dockerfile: ./Dockerfile
    depends_on:
      - libsql
    environment:
      NODE_ENV: production
      LIBSQL_URL: http://libsql:8080
      BEARER_TOKEN: ${BEARER_TOKEN}
      REFRESH_TOKEN: ${REFRESH_TOKEN}
      TOKEN_ENDPOINT_URL: ${TOKEN_ENDPOINT_URL}
      CLIENT_ID: ${CLIENT_ID}
      CLIENT_SECRET: ${CLIENT_SECRET}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
      SLACK_WEBHOOK_URL: ${SLACK_WEBHOOK_URL}
    ports:
      - 3001:3001
    restart: unless-stopped

volumes:
  libsql-data:
```

### Success Criteria

- [x] `docker compose up -d` starts both containers
- [x] libSQL accessible at `http://localhost:8080`
- [x] Data persists in `libsql-data` volume

---

## Phase 2: Add libSQL Client Dependency

### Changes

**File: `package.json`** - Add dependency:

```json
{
  "dependencies": {
    "@libsql/client": "^0.14.0"
  }
}
```

**File: `db.js`** - Create new database module:

```javascript
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.LIBSQL_URL || 'http://localhost:8080'
});

// Initialize schema
async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bearer_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  console.log('Database initialized');
}

// Get current tokens
async function getTokens() {
  const result = await db.execute('SELECT bearer_token, refresh_token FROM tokens WHERE id = 1');
  if (result.rows.length === 0) {
    return null;
  }
  return {
    bearerToken: result.rows[0].bearer_token,
    refreshToken: result.rows[0].refresh_token
  };
}

// Save tokens (upsert)
async function saveTokens(bearerToken, refreshToken) {
  await db.execute({
    sql: `INSERT INTO tokens (id, bearer_token, refresh_token, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            bearer_token = excluded.bearer_token,
            refresh_token = excluded.refresh_token,
            updated_at = datetime('now')`,
    args: [bearerToken, refreshToken]
  });
  console.log('Tokens saved to database');
}

module.exports = { db, initDb, getTokens, saveTokens };
```

### Success Criteria

- [x] `npm install` completes without errors
- [x] `db.js` can be required without errors

---

## Phase 3: Update app.js to Use Database

### Changes

**File: `app.js`** - Modify token initialization and refresh logic:

1. **Add import at top:**
```javascript
const { initDb, getTokens, saveTokens } = require('./db');
```

2. **Modify token initialization (around line 15-20):**
```javascript
// Environment variables (used as fallback/initial values)
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;

// Load tokens from database on startup
async function loadTokens() {
  try {
    await initDb();
    const dbTokens = await getTokens();
    if (dbTokens) {
      console.log('Loaded tokens from database');
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      // First run - save env tokens to database
      console.log('No tokens in database, saving from environment');
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
  } catch (error) {
    console.error('Error loading tokens from database:', error);
    console.log('Falling back to environment variables');
  }
}
```

3. **Modify refreshAccessToken function (replace updateEnvFile calls):**
```javascript
// After getting new tokens, save to database instead of .env file
console.log('Access token refreshed successfully.');
BEARER_TOKEN = newAccessToken;
await saveTokens(newAccessToken, newRefreshToken || REFRESH_TOKEN);

if (newRefreshToken) {
  console.log('New refresh token received.');
  REFRESH_TOKEN = newRefreshToken;
}
```

4. **Remove updateEnvFile function** (no longer needed)

5. **Modify app startup:**
```javascript
// At the end of the file, wrap app.listen in async startup
async function startServer() {
  await loadTokens();
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
```

### Success Criteria

- [x] App starts and connects to libSQL
- [x] Tokens loaded from database (or saved if first run)
- [x] Token refresh saves to database
- [x] Container restart preserves tokens

---

## Phase 4: Update GitHub Actions Deploy

### Changes

**File: `.github/workflows/deploy.yml`**

1. **Add LIBSQL_URL to environment:**
```yaml
- name: Create environment file
  run: |
    echo "Creating .env file..."
    cat > .env << EOF
    NODE_ENV=production
    PORT=3001
    LIBSQL_URL=http://libsql:8080
    BEARER_TOKEN=${{ secrets.BEARER_TOKEN }}
    REFRESH_TOKEN=${{ secrets.REFRESH_TOKEN }}
    TOKEN_ENDPOINT_URL=${{ secrets.TOKEN_ENDPOINT_URL }}
    CLIENT_ID=${{ secrets.CLIENT_ID }}
    CLIENT_SECRET=${{ secrets.CLIENT_SECRET }}
    SLACK_SIGNING_SECRET=${{ secrets.SLACK_SIGNING_SECRET }}
    SLACK_WEBHOOK_URL=${{ secrets.SLACK_WEBHOOK_URL }}
    EOF
```

2. **Update container start to use docker compose:**
```yaml
- name: Start containers
  run: |
    echo "Starting containers with docker compose..."
    docker compose up -d --build
```

3. **Update verify step for compose:**
```yaml
- name: Verify deployment
  run: |
    echo "Waiting for containers to start..."
    sleep 15
    if docker compose ps | grep -q "Up"; then
      echo "✅ Containers are running!"
      docker compose ps
      echo "Testing health endpoint..."
      if curl -f http://localhost:3001/health; then
        echo "✅ Health check passed!"
      else
        echo "❌ Health check failed!"
        docker compose logs
        exit 1
      fi
    else
      echo "❌ Containers failed to start!"
      docker compose logs
      exit 1
    fi
```

4. **Update test refresh step:**
```yaml
- name: Test refresh token
  run: |
    echo "Testing refresh token functionality..."
    if docker compose exec -T mcpslackbot node tests/test_refresh.js; then
      echo "✅ Refresh token test passed!"
    else
      echo "❌ Refresh token test failed!"
      docker compose logs
      exit 1
    fi
```

### Success Criteria

- [x] GitHub Actions workflow completes successfully
- [x] Both containers start via docker compose
- [x] Health check passes
- [x] Refresh token test passes

---

## Phase 5: Update Test Script

### Changes

**File: `tests/test_refresh.js`**

Update to use database instead of .env file:

```javascript
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const qs = require('qs');
const { createClient } = require('@libsql/client');

// Database connection
const db = createClient({
  url: process.env.LIBSQL_URL || 'http://localhost:8080'
});

// Environment variables (fallback)
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;

// Load tokens from database
async function loadTokens() {
  try {
    const result = await db.execute('SELECT bearer_token, refresh_token FROM tokens WHERE id = 1');
    if (result.rows.length > 0) {
      BEARER_TOKEN = result.rows[0].bearer_token;
      REFRESH_TOKEN = result.rows[0].refresh_token;
      console.log('Loaded tokens from database');
    }
  } catch (error) {
    console.log('Could not load from database, using environment variables');
  }
}

// Save tokens to database
async function saveTokens(bearerToken, refreshToken) {
  await db.execute({
    sql: `INSERT INTO tokens (id, bearer_token, refresh_token, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            bearer_token = excluded.bearer_token,
            refresh_token = excluded.refresh_token,
            updated_at = datetime('now')`,
    args: [bearerToken, refreshToken]
  });
  console.log('Tokens saved to database');
}

// Function to refresh the access token
async function refreshAccessToken() {
  console.log('Attempting to refresh access token...');
  try {
    const data = qs.stringify({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN
    });

    const response = await axios.post(TOKEN_ENDPOINT_URL, data, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('Response received:', JSON.stringify(response.data, null, 2));

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;

    if (!newAccessToken) {
      throw new Error('New access token not found in refresh response');
    }

    console.log('Access token refreshed successfully.');
    BEARER_TOKEN = newAccessToken;

    if (newRefreshToken) {
      console.log('New refresh token received.');
      REFRESH_TOKEN = newRefreshToken;
    }

    // Save to database
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);

    return true;
  } catch (error) {
    console.error('Error refreshing access token:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    return false;
  }
}

// Run the test
async function runTest() {
  if (!TOKEN_ENDPOINT_URL) {
    console.error('TOKEN_ENDPOINT_URL environment variable is required');
    process.exit(1);
  }

  await loadTokens();

  if (!REFRESH_TOKEN) {
    console.error('REFRESH_TOKEN not found in database or environment');
    process.exit(1);
  }

  console.log('Starting token refresh test...');
  console.log('Current Bearer Token (first 20 chars):', BEARER_TOKEN ? BEARER_TOKEN.substring(0, 20) + '...' : 'NOT SET');
  console.log('Current Refresh Token:', REFRESH_TOKEN ? REFRESH_TOKEN.substring(0, 20) + '...' : 'NOT SET');

  const result = await refreshAccessToken();

  if (result) {
    console.log('Test successful!');
    console.log('New Bearer Token (first 20 chars):', BEARER_TOKEN.substring(0, 20) + '...');
    console.log('New Refresh Token:', REFRESH_TOKEN.substring(0, 20) + '...');
    process.exit(0);
  } else {
    console.error('Test failed.');
    process.exit(1);
  }
}

runTest().catch(error => {
  console.error('Unexpected error in test:', error);
  process.exit(1);
});
```

### Success Criteria

- [x] Test script loads tokens from database
- [x] Test script saves refreshed tokens to database
- [x] Test passes with database persistence

---

## Phase 6: Manual Testing

### Test Procedure

1. **Deploy with docker compose:**
   ```bash
   docker compose up -d --build
   ```

2. **Verify libSQL is running:**
   ```bash
   curl http://localhost:8080/health
   ```

3. **Check tokens were saved:**
   ```bash
   docker compose exec mcpslackbot node -e "
     const { createClient } = require('@libsql/client');
     const db = createClient({ url: 'http://libsql:8080' });
     db.execute('SELECT * FROM tokens').then(r => console.log(r.rows));
   "
   ```

4. **Test refresh:**
   ```bash
   docker compose exec mcpslackbot node tests/test_refresh.js
   ```

5. **Restart and verify persistence:**
   ```bash
   docker compose restart mcpslackbot
   docker compose exec mcpslackbot node -e "
     const { createClient } = require('@libsql/client');
     const db = createClient({ url: 'http://libsql:8080' });
     db.execute('SELECT * FROM tokens').then(r => console.log(r.rows));
   "
   ```

6. **Test Slack command works after restart**

### Success Criteria

- [ ] libSQL container healthy
- [ ] Tokens saved to database on first run
- [ ] Tokens persist after container restart
- [ ] Refresh updates tokens in database
- [ ] Slack commands work after restart

---

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `docker compose.yml` | Modify | Add libSQL service and volume |
| `package.json` | Modify | Add @libsql/client dependency |
| `db.js` | Create | New database module |
| `app.js` | Modify | Use database for tokens, remove updateEnvFile |
| `tests/test_refresh.js` | Modify | Use database instead of .env |
| `.github/workflows/deploy.yml` | Modify | Use docker compose, add LIBSQL_URL |

---

## Rollback Plan

If issues occur:

1. Revert to environment-only tokens:
   ```bash
   git checkout main -- docker compose.yml app.js package.json
   ```

2. Remove libSQL volume:
   ```bash
   docker volume rm mcp-slackbot_libsql-data
   ```

3. Redeploy with fresh tokens from GitHub Secrets

---

## Sources

- [libSQL Docker Documentation](https://github.com/tursodatabase/libsql/blob/main/docs/DOCKER.md)
- [libSQL docker compose example](https://github.com/tursodatabase/libsql/blob/main/docker compose/docker compose.yml)
- [@libsql/client npm package](https://www.npmjs.com/package/@libsql/client)
