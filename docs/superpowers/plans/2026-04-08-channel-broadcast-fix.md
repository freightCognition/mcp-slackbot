# Channel Broadcast Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `/mcp` channel broadcast so the risk assessment summary is visible to all channel members, regardless of whether the bot has been invited to the channel.

**Architecture:** Replace `client.chat.postMessage()` with `respond({ response_type: "in_channel" })` for the channel broadcast. The `respond` function uses the slash command's `response_url`, which works in any channel where the command was invoked without requiring bot channel membership. The modal update continues to use `client.views.update()` as before. Add a success log so future issues are diagnosable.

**Tech Stack:** @slack/bolt (Socket Mode), Bun test runner

---

## Root Cause

`client.chat.postMessage()` requires the bot to be a **member of the channel**. When the bot isn't invited to a channel, the call fails silently because the error is caught and logged as non-fatal (line 1284-1290 of `app.js`). The modal still opens fine because `views.update()` uses the loading view ID, not channel membership.

`respond({ response_type: "in_channel" })` uses the slash command's `response_url` — it works in any channel where the command was typed, no bot membership required.

---

### Task 1: Write failing test for channel broadcast using `respond`

**Files:**
- Create: `tests/channel_broadcast_respond.test.js`

This test verifies that the `/mcp` command handler calls `respond` with `response_type: "in_channel"` and the correct blocks when carrier data is fetched successfully. We test the exported `buildChannelAssessmentBlocks` function and verify the expected respond payload structure.

- [ ] **Step 1: Write the test file**

```js
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

// Set dummy env vars before importing app.js
process.env.BEARER_TOKEN = process.env.BEARER_TOKEN || "test-bearer";
process.env.REFRESH_TOKEN = process.env.REFRESH_TOKEN || "test-refresh";
process.env.TOKEN_ENDPOINT_URL =
  process.env.TOKEN_ENDPOINT_URL || "http://localhost/token";
process.env.CLIENT_ID = process.env.CLIENT_ID || "test-client-id";
process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || "test-secret";
process.env.SLACK_SIGNING_SECRET =
  process.env.SLACK_SIGNING_SECRET || "test-signing";
process.env.SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || "xoxb-test";
process.env.SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || "xapp-test";

const {
  buildChannelAssessmentBlocks,
  getRiskLevelEmoji,
  getRiskLevel,
  normalizeNullableText,
} = require("../app");

const carrierResponse = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/carrier-response.json"), "utf-8"),
);

describe("channel broadcast respond payload", () => {
  it("builds correct in_channel respond payload from carrier data", () => {
    const carrierData = carrierResponse;
    const mcNumber = "789012";
    const userId = "U12345";

    const assessmentBlocks = buildChannelAssessmentBlocks(
      carrierData,
      mcNumber,
      userId,
    );
    const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
    const carrierName = normalizeNullableText(
      data.CompanyName,
      "Unknown Carrier",
    );
    const risk = data.RiskAssessmentDetails || {};
    const totalPoints = risk.TotalPoints || 0;

    // This is the payload that respond() should receive
    const payload = {
      response_type: "in_channel",
      text: `<@${userId}> is reviewing ${carrierName} (MC${mcNumber}) - ${getRiskLevelEmoji(totalPoints)} ${getRiskLevel(totalPoints)}`,
      blocks: assessmentBlocks,
    };

    expect(payload.response_type).toBe("in_channel");
    expect(payload.text).toContain("<@U12345>");
    expect(payload.text).toContain("TEST TRUCKING LLC");
    expect(payload.text).toContain("MC789012");
    expect(payload.blocks).toHaveLength(4);
    expect(payload.blocks[0].type).toBe("section");
  });

  it("includes risk level emoji and label in fallback text", () => {
    const carrierData = carrierResponse;
    const mcNumber = "789012";
    const userId = "U12345";

    const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
    const risk = data.RiskAssessmentDetails || {};
    const totalPoints = risk.TotalPoints || 0;
    const carrierName = normalizeNullableText(
      data.CompanyName,
      "Unknown Carrier",
    );

    const text = `<@${userId}> is reviewing ${carrierName} (MC${mcNumber}) - ${getRiskLevelEmoji(totalPoints)} ${getRiskLevel(totalPoints)}`;

    expect(text).toContain(getRiskLevelEmoji(totalPoints));
    expect(text).toContain(getRiskLevel(totalPoints));
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
bun test tests/channel_broadcast_respond.test.js
```

Expected: PASS — this test validates the payload structure that respond() will receive. It passes because we're testing data assembly, not the actual respond() call.

- [ ] **Step 3: Commit**

```bash
git add tests/channel_broadcast_respond.test.js
git commit -m "test: add channel broadcast respond payload tests"
```

---

### Task 2: Replace `chat.postMessage` with `respond` for channel broadcast

**Files:**
- Modify: `app.js:1262-1306` (the parallel promise section in the `/mcp` handler)

The fix replaces the `channelMessagePromise` that uses `client.chat.postMessage()` with a call to `respond({ response_type: "in_channel" })`. This removes the bot channel membership requirement. Add a success log for diagnosability.

- [ ] **Step 1: Replace the channel message promise with respond call**

In `app.js`, find this block (lines 1262-1306):

```js
  // Post channel message and update modal in parallel
  const view = buildStep1View(carrierData, mcNumber, channel_id);

  const channelMessagePromise = (async () => {
    try {
      const assessmentBlocks = buildChannelAssessmentBlocks(
        carrierData,
        mcNumber,
        user_id,
      );
      const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
      const carrierName = normalizeNullableText(
        data.CompanyName,
        "Unknown Carrier",
      );
      const risk = data.RiskAssessmentDetails || {};
      const totalPoints = risk.TotalPoints || 0;
      await client.chat.postMessage({
        channel: channel_id,
        text: `<@${user_id}> is reviewing ${carrierName} (MC${mcNumber}) - ${getRiskLevelEmoji(totalPoints)} ${getRiskLevel(totalPoints)}`,
        blocks: assessmentBlocks,
      });
    } catch (error) {
      logger.error(
        { err: error, mcNumber },
        "Failed to post assessment channel message",
      );
      // Non-fatal: modal update continues regardless
    }
  })();

  const modalUpdatePromise = (async () => {
    try {
      await client.views.update({
        view_id: loadingViewId,
        view,
      });
      logger.info({ mcNumber, userId: user_id }, "Opened carrier wizard modal");
    } catch (error) {
      logger.error({ err: error, mcNumber }, "Failed to update modal");
      clearActiveAssessment(channel_id);
    }
  })();

  await Promise.all([channelMessagePromise, modalUpdatePromise]);
```

Replace with:

```js
  // Build Step 1 view and post channel broadcast + update modal in parallel
  const view = buildStep1View(carrierData, mcNumber, channel_id);

  const channelMessagePromise = (async () => {
    try {
      const assessmentBlocks = buildChannelAssessmentBlocks(
        carrierData,
        mcNumber,
        user_id,
      );
      const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
      const carrierName = normalizeNullableText(
        data.CompanyName,
        "Unknown Carrier",
      );
      const risk = data.RiskAssessmentDetails || {};
      const totalPoints = risk.TotalPoints || 0;
      await respond({
        response_type: "in_channel",
        text: `<@${user_id}> is reviewing ${carrierName} (MC${mcNumber}) - ${getRiskLevelEmoji(totalPoints)} ${getRiskLevel(totalPoints)}`,
        blocks: assessmentBlocks,
      });
      logger.info(
        { mcNumber, userId: user_id },
        "Posted channel assessment broadcast",
      );
    } catch (error) {
      logger.error(
        { err: error, mcNumber, channelId: channel_id },
        "Failed to post assessment channel message",
      );
    }
  })();

  const modalUpdatePromise = (async () => {
    try {
      await client.views.update({
        view_id: loadingViewId,
        view,
      });
      logger.info({ mcNumber, userId: user_id }, "Opened carrier wizard modal");
    } catch (error) {
      logger.error({ err: error, mcNumber }, "Failed to update modal");
      clearActiveAssessment(channel_id);
    }
  })();

  await Promise.all([channelMessagePromise, modalUpdatePromise]);
```

**Changes:**
1. `client.chat.postMessage({ channel: channel_id, ... })` → `respond({ response_type: "in_channel", ... })`
2. Added success log: `"Posted channel assessment broadcast"`
3. Added `channelId` to error log context for debugging

- [ ] **Step 2: Run the full test suite to verify no regressions**

```bash
bun test
```

Expected: All existing tests PASS. The change is in the command handler (not unit-tested), so existing unit tests for `buildChannelAssessmentBlocks` and other functions should be unaffected.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "fix: use respond() for channel broadcast instead of chat.postMessage

Replace client.chat.postMessage() with respond({ response_type: 'in_channel' })
for the channel risk assessment broadcast. chat.postMessage requires the bot to be
a member of the channel, which silently fails when the bot hasn't been invited.
respond() uses the slash command's response_url which works in any channel.

Added success logging for diagnosability."
```

---

### Task 3: Run full test suite and verify

**Files:**
- None (verification only)

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: All tests pass, including `tests/channel_broadcast_respond.test.js`, `tests/channel_assessment.test.js`, and `tests/app.test.js`.

- [ ] **Step 2: Run linter**

```bash
bun run lint
```

Expected: No lint errors.

- [ ] **Step 3: Verify the diff is minimal and correct**

```bash
git diff main -- app.js
```

Verify only the channel message block changed:
- `client.chat.postMessage` → `respond`
- Added `response_type: "in_channel"`
- Added success log line
- Added `channelId` to error log
- Removed `channel:` property (not needed with respond)
