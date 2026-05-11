import { describe, it, expect } from "vitest";
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

const { buildChannelAssessmentBlocks } = require("../app");

const carrierResponse = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/carrier-response.json"), "utf-8"),
);
const highRiskResponse = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/carrier-high-risk.json"), "utf-8"),
);

describe("buildChannelAssessmentBlocks", () => {
  it("returns 4 blocks with correct structure", () => {
    const blocks = buildChannelAssessmentBlocks(
      carrierResponse,
      "789012",
      "U12345",
    );
    expect(blocks).toHaveLength(4);
    expect(blocks[0].type).toBe("section");
    expect(blocks[1].type).toBe("section");
    expect(blocks[1].fields).toHaveLength(4);
    expect(blocks[2].type).toBe("section");
    expect(blocks[3].type).toBe("context");
  });

  it("includes user mention and carrier name in header", () => {
    const blocks = buildChannelAssessmentBlocks(
      carrierResponse,
      "789012",
      "U12345",
    );
    expect(blocks[0].text.text).toContain("<@U12345>");
    expect(blocks[0].text.text).toContain("TEST TRUCKING LLC");
  });

  it("shows carrier identifiers in fields", () => {
    const blocks = buildChannelAssessmentBlocks(
      carrierResponse,
      "789012",
      "U12345",
    );
    const fieldTexts = blocks[1].fields.map((f) => f.text);
    expect(fieldTexts).toContain("*MC:* MC789012");
    expect(fieldTexts).toContain("*DOT:* 123456");
  });

  it("shows medium risk for 150 points", () => {
    const blocks = buildChannelAssessmentBlocks(
      carrierResponse,
      "789012",
      "U12345",
    );
    expect(blocks[2].text.text).toContain("🟡");
    expect(blocks[2].text.text).toContain("Medium");
    expect(blocks[2].text.text).toContain("150 pts");
  });

  it("shows fail risk for high-risk carrier", () => {
    const blocks = buildChannelAssessmentBlocks(
      highRiskResponse,
      "555555",
      "U99999",
    );
    expect(blocks[2].text.text).toContain("🔴");
    expect(blocks[2].text.text).toContain("Fail");
    expect(blocks[2].text.text).toContain("3500 pts");
  });

  it("shows category breakdown in context block", () => {
    const blocks = buildChannelAssessmentBlocks(
      highRiskResponse,
      "555555",
      "U99999",
    );
    const contextText = blocks[3].elements[0].text;
    expect(contextText).toContain("Authority");
    expect(contextText).toContain("Insurance");
    expect(contextText).toContain("Safety");
    expect(contextText).toContain("·");
  });

  it("handles non-array carrier data", () => {
    const singleData = carrierResponse[0];
    const blocks = buildChannelAssessmentBlocks(singleData, "789012", "U12345");
    expect(blocks).toHaveLength(4);
    expect(blocks[0].text.text).toContain("TEST TRUCKING LLC");
  });

  it("handles missing risk data gracefully", () => {
    const noRiskData = { CompanyName: "NO RISK CARRIER" };
    const blocks = buildChannelAssessmentBlocks(noRiskData, "000000", "U12345");
    expect(blocks[2].text.text).toContain("🟢");
    expect(blocks[2].text.text).toContain("Low");
    expect(blocks[3].elements[0].text).toBe("No risk data available");
  });

  it("handles missing company name", () => {
    const noName = { RiskAssessmentDetails: { TotalPoints: 0 } };
    const blocks = buildChannelAssessmentBlocks(noName, "000000", "U12345");
    expect(blocks[0].text.text).toContain("Unknown Carrier");
  });
});
