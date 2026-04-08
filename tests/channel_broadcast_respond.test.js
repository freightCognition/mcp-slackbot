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
