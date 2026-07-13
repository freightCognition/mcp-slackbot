// Regression tests for PR #45 review findings (greptile / devin).
import { describe, it, expect, beforeEach } from "vitest";
import {
  installMockAxios,
  installMockSlackBolt,
} from "./helpers/cjs-mocks.js";

installMockSlackBolt();

// Mutable axios stub — each test sets `axiosImpl.request` to shape the response.
const axiosImpl = { request: async () => ({ data: {} }) };
installMockAxios({ request: (config) => axiosImpl.request(config) });

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
  isRiskPointsAvailable,
  formatRiskLevel,
  fetchCarrierData,
  buildChannelAssessmentBlocks,
  buildStep1View,
  buildStep4View,
  wizardState,
} = await import("../app.js");

describe("risk score availability helpers", () => {
  it("distinguishes a genuine zero from a missing score", () => {
    expect(isRiskPointsAvailable(0)).toBe(true);
    expect(isRiskPointsAvailable(150)).toBe(true);
    expect(isRiskPointsAvailable("150")).toBe(true);
    expect(isRiskPointsAvailable(undefined)).toBe(false);
    expect(isRiskPointsAvailable(null)).toBe(false);
    expect(isRiskPointsAvailable(NaN)).toBe(false);
    expect(isRiskPointsAvailable("not-a-number")).toBe(false);
  });

  it("formats a present score and flags a missing one", () => {
    expect(formatRiskLevel(0)).toBe("🟢 Low (0 pts)");
    expect(formatRiskLevel(150)).toBe("🟡 Medium (150 pts)");
    const missing = formatRiskLevel(undefined);
    expect(missing).toContain("⚠️");
    expect(missing).toContain("unavailable");
    expect(missing).not.toContain("🟢");
  });
});

describe("fetchCarrierData numeric field defaulting", () => {
  it("preserves a legitimate zero truck/driver/power count", async () => {
    axiosImpl.request = async (config) => {
      if (config.url.includes("GetCarrierData")) {
        return {
          data: {
            AssureAdvantage: [
              {
                CarrierDetails: {
                  Identity: { legalName: "ZERO FLEET" },
                  Equipment: { trucksTotal: 0, totalPower: 0 },
                  Drivers: { driversTotal: 0 },
                },
              },
            ],
          },
        };
      }
      return { data: { RiskAssessmentDetails: { TotalPoints: 10 } } };
    };

    const result = await fetchCarrierData("111111");
    expect(result.success).toBe(true);
    expect(result.data.TrucksTotal).toBe(0);
    expect(result.data.DriversTotal).toBe(0);
    expect(result.data.PowerUnits).toBe(0);
  });
});

describe("missing risk assessment is not presented as favorable", () => {
  it("keeps modal and channel broadcast consistent when risk data is absent", async () => {
    axiosImpl.request = async (config) => {
      if (config.url.includes("GetCarrierData")) {
        return {
          data: {
            AssureAdvantage: [
              { CarrierDetails: { Identity: { legalName: "NO RISK CO" } } },
            ],
          },
        };
      }
      // Risk endpoint fails while the profile succeeds.
      const err = new Error("risk endpoint down");
      err.response = { status: 500, data: {} };
      throw err;
    };

    const result = await fetchCarrierData("222222");
    expect(result.success).toBe(true);
    expect(result.data.RiskAssessmentDetails).toBeNull();

    const broadcast = buildChannelAssessmentBlocks(
      result.data,
      "222222",
      "U1",
    );
    expect(broadcast[2].text.text).toContain("unavailable");
    expect(broadcast[2].text.text).not.toContain("🟢");

    const step1 = buildStep1View(result.data, "222222", "C1");
    const step1Text = JSON.stringify(step1.blocks);
    expect(step1Text).toContain("unavailable");
    expect(step1Text).not.toContain("(0 pts)");
  });
});

describe("contact selection avoids 75-char option truncation", () => {
  beforeEach(() => {
    wizardState.clear();
  });

  it("stores a short option id and resolves the full email from state", () => {
    const wizardId = "wiz-contact-test";
    wizardState.set(wizardId, {
      carrierData: { CompanyName: "LONG EMAIL CARRIER" },
      mcNumber: "333333",
      channelId: "C1",
    });

    // 106 chars — well past Slack's 75-char option value cap.
    const longEmail = `${"a".repeat(70)}@really-long-domain-name-example.com`;
    expect(longEmail.length).toBeGreaterThan(75);

    const view = buildStep4View(wizardId, [
      { FirstName: "Jane", LastName: "Doe", Email: longEmail },
    ]);

    const selectBlock = view.blocks.find(
      (b) => b.accessory?.type === "static_select",
    );
    expect(selectBlock).toBeDefined();
    const option = selectBlock.accessory.options[0];

    // The option value must be a short id, never the (truncated) email.
    expect(option.value).toBe("contact_0");
    expect(option.value.length).toBeLessThanOrEqual(75);

    // The full, untruncated email is recoverable from wizard state.
    const stored = wizardState.get(wizardId);
    expect(stored.contactEmails.contact_0).toBe(longEmail);
  });
});
