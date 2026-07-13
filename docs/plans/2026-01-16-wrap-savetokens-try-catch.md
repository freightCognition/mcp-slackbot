# Wrap saveTokens in try/catch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent database errors from bubbling up and marking token refresh as failed by wrapping `saveTokens` in a try/catch block.

**Architecture:** The `saveTokens` call at line 298 in `refreshAccessToken()` currently sits inside the function's main try/catch. If it throws, the entire refresh is marked as failed even though the in-memory tokens are valid. We'll wrap just the `saveTokens` call in its own try/catch, log the error with safe context, and continue returning success.

**Tech Stack:** Node.js, Pino logger, LibSQL

---

### Task 1: Wrap saveTokens in isolated try/catch

**Files:**
- Modify: `app.js:297-298`

**Step 1: Locate and wrap the saveTokens call**

Replace lines 297-298:

```javascript
    // Save tokens to database
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
```

With:

```javascript
    // Save tokens to database (non-blocking - in-memory tokens remain valid if DB fails)
    try {
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    } catch (dbError) {
      logger.error({
        err: dbError,
        context: 'refreshAccessToken',
        tokenRefreshSucceeded: true,
        newRefreshIssued
      }, 'Failed to persist tokens to database - in-memory tokens remain valid');
    }
```

**Step 2: Verify the change compiles**

Run: `node --check app.js`
Expected: No output (clean syntax)

**Step 3: Commit**

```bash
git add app.js
git commit -m "fix: wrap saveTokens in try/catch to prevent DB errors from failing token refresh

Database errors during token persistence no longer bubble up and mark
the refresh as failed. In-memory tokens remain valid even if DB save
fails. Error is logged with context for debugging."
```

---

### Task 2: Manual verification

**Step 1: Review the error handling behavior**

The change ensures:
1. Database errors are caught separately from token refresh errors
2. The error is logged with structured context (`err`, `context`, `tokenRefreshSucceeded`, `newRefreshIssued`)
3. No rethrow - function continues to return `{ success: true, newRefreshIssued }`
4. In-memory `BEARER_TOKEN` and `REFRESH_TOKEN` remain set with their new values

**Step 2: Confirm existing tests still pass**

Run: `npm test` (if configured) or manually verify the app starts:
```bash
node --check app.js && echo "Syntax OK"
```

---

## Summary

This is a minimal, focused change that:
- Isolates database persistence errors from the token refresh success path
- Logs errors with sufficient context for debugging
- Does NOT rethrow, allowing the refresh to report success
- Keeps in-memory tokens valid for continued operation
