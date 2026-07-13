# PR Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address all PR review comments from coderabbitai and baz-reviewer bots to improve code quality and fix deployment configuration.

**Architecture:** Three targeted fixes: (1) alphabetize environment variables in .env.example per dotenv-linter, (2) add helper function to reduce duplication of ephemeral respond calls, (3) add missing SLACK_APP_TOKEN to docker-compose.yml for Socket Mode support.

**Tech Stack:** Node.js, @slack/bolt, Docker Compose

---

### Task 1: Fix .env.example alphabetical ordering

**Files:**
- Modify: `.env.example:8-11`

**Context:** The dotenv-linter reports that `SLACK_APP_TOKEN` should come before `SLACK_BOT_TOKEN` alphabetically.

**Step 1: Update .env.example with correct ordering**

Edit `.env.example` to reorder the Slack configuration variables alphabetically:

```
# Slack configuration
SLACK_APP_TOKEN=your_slack_app_token_here
SLACK_BOT_TOKEN=your_slack_bot_token_here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
```

**Step 2: Verify the change**

Run: `cat .env.example`
Expected: Slack variables appear in alphabetical order (APP, BOT, SIGNING)

**Step 3: Commit**

```bash
git add .env.example
git commit -m "style: alphabetize Slack env vars in .env.example

Fixes dotenv-linter UnorderedKey warning by placing SLACK_APP_TOKEN
before SLACK_BOT_TOKEN.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Add ephemeral helper function to reduce duplication

**Files:**
- Modify: `app.js:172-183` (add helper at start of command handler)
- Modify: `app.js:207-211` (first usage)
- Modify: `app.js:347-351` (second usage)
- Modify: `app.js:363-366` (third usage)

**Context:** The baz-reviewer bot noted that `await respond({ text: ..., response_type: 'ephemeral' }); return;` pattern appears 3+ times. A helper function will improve maintainability.

**Step 1: Add ephemeral helper inside command handler**

At line 174 (after `await ack();`), add the helper:

```javascript
  // Helper for ephemeral responses
  const ephemeral = async (text) => respond({ text, response_type: 'ephemeral' });
```

**Step 2: Replace first duplicated block (lines 177-183)**

Replace:
```javascript
  if (!text) {
    await respond({
      text: 'Please provide a valid MC number.',
      response_type: 'ephemeral'
    });
    return;
  }
```

With:
```javascript
  if (!text) {
    await ephemeral('Please provide a valid MC number.');
    return;
  }
```

**Step 3: Replace second duplicated block (lines 205-212)**

Replace:
```javascript
      if (!apiResponse.data || apiResponse.data.length === 0) {
        logger.info({ mcNumber }, 'No data found for MC number');
        await respond({
          text: 'No data found for the provided MC number.',
          response_type: 'ephemeral'
        });
        return;
      }
```

With:
```javascript
      if (!apiResponse.data || apiResponse.data.length === 0) {
        logger.info({ mcNumber }, 'No data found for MC number');
        await ephemeral('No data found for the provided MC number.');
        return;
      }
```

**Step 4: Replace third duplicated block (token refresh failure)**

Replace:
```javascript
          logger.error({ mcNumber }, 'Failed to refresh token. Aborting.');
          await respond({
            text: 'Error: Could not refresh authentication. Please check logs or contact admin.',
            response_type: 'ephemeral'
          });
          return;
```

With:
```javascript
          logger.error({ mcNumber }, 'Failed to refresh token. Aborting.');
          await ephemeral('Error: Could not refresh authentication. Please check logs or contact admin.');
          return;
```

**Step 5: Replace fourth duplicated block (general error handling)**

Replace:
```javascript
        await respond({
          text: userMessage,
          response_type: 'ephemeral'
        });
        return;
```

With:
```javascript
        await ephemeral(userMessage);
        return;
```

**Step 6: Verify the application still starts**

Run: `bun run start` (or use dry-run if no credentials)
Expected: App starts without syntax errors (Ctrl+C to stop)

**Step 7: Commit**

```bash
git add app.js
git commit -m "refactor: add ephemeral helper to reduce respond duplication

Introduces const ephemeral = async (text) => respond({ text, response_type: 'ephemeral' })
inside the /mcp command handler. Replaces 4 identical respond blocks with
ephemeral() calls, improving maintainability.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Add SLACK_APP_TOKEN to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml:28-30`

**Context:** The baz-reviewer bot identified a breaking change: `SLACK_APP_TOKEN` is required for Socket Mode but wasn't added to docker-compose.yml. The app will exit immediately without it.

**Step 1: Add SLACK_APP_TOKEN environment variable**

In docker-compose.yml, add `SLACK_APP_TOKEN` to the mcpslackbot service environment and remove the obsolete `SLACK_WEBHOOK_URL`:

Replace:
```yaml
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
      SLACK_WEBHOOK_URL: ${SLACK_WEBHOOK_URL}
```

With:
```yaml
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
```

Note: Variables are alphabetized and `SLACK_WEBHOOK_URL` is removed (no longer used with Socket Mode).

**Step 2: Verify docker-compose syntax**

Run: `docker compose config --quiet && echo "Valid"`
Expected: "Valid" (no output means valid YAML)

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: add SLACK_APP_TOKEN to docker-compose.yml for Socket Mode

Adds required SLACK_APP_TOKEN environment variable and removes obsolete
SLACK_WEBHOOK_URL. Without this, the container exits immediately with
'SLACK_APP_TOKEN environment variable is required'.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

**Step 1: Run linter (if available)**

Run: `bun run lint` (if configured)
Expected: No errors

**Step 2: Run tests**

Run: `bun test`
Expected: All tests pass

**Step 3: Verify all changes are committed**

Run: `git status`
Expected: Clean working directory

**Step 4: Push changes**

Run: `git push`
Expected: Changes pushed to remote branch

---

## Summary of Changes

| File | Change | Addresses |
|------|--------|-----------|
| `.env.example` | Alphabetize SLACK_* variables | coderabbitai dotenv-linter warning |
| `app.js` | Add `ephemeral()` helper, replace 4 duplicate blocks | baz-reviewer conciseness finding |
| `docker-compose.yml` | Add `SLACK_APP_TOKEN`, remove `SLACK_WEBHOOK_URL` | baz-reviewer breaking change finding |
