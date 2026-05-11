import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Set dummy env vars before importing app.js to prevent process.exit
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
  getRiskLevelEmoji,
  getRiskLevel,
  normalizeNullableText,
  formatSlackLinks,
  chunkLines,
  hasActiveAssessment,
  setActiveAssessment,
  clearActiveAssessment,
  generateWizardId,
  buildSessionExpiredView,
  buildStep2View,
  buildStep3View,
  buildStep4View,
  wizardState,
  activeAssessments,
} = require("../app");

// Load fixtures
const carrierResponse = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/carrier-response.json"), "utf-8"),
);
const highRiskResponse = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/carrier-high-risk.json"), "utf-8"),
);

// Helper: build slack blocks locally for fixture tests (mirrors logic from app.js)
function formatInfractions(infractions) {
  if (!infractions || infractions.length === 0) {
    return "No infractions found.";
  }
  return infractions
    .map((infraction) => {
      const ruleText = normalizeNullableText(
        infraction.RuleText,
        "Unknown infraction",
      );
      const output = normalizeNullableText(infraction.RuleOutput, "");
      const points = infraction.Points ?? "N/A";
      if (output) {
        return `- ${ruleText}: ${output} (${points} points)`;
      }
      return `- ${ruleText} (${points} points)`;
    })
    .join("\n");
}

function buildSlackBlocks(data) {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "MyCarrierPortal Risk Assessment",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${data.CompanyName || "N/A"}*\nDOT: ${data.DotNumber || "N/A"} / MC: ${data.DocketNumber || "N/A"}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Overall assessment:* ${getRiskLevelEmoji(data.RiskAssessmentDetails?.TotalPoints)} ${getRiskLevel(data.RiskAssessmentDetails?.TotalPoints)}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Total Points: ${data.RiskAssessmentDetails?.TotalPoints || "N/A"}`,
        },
      ],
    },
    { type: "divider" },
  ];

  const categories = ["Authority", "Insurance", "Operation", "Safety", "Other"];
  categories.forEach((category) => {
    const categoryData = data.RiskAssessmentDetails?.[category];
    if (categoryData) {
      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${category}:* ${getRiskLevelEmoji(categoryData.TotalPoints)} ${getRiskLevel(categoryData.TotalPoints)}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Risk Level: ${getRiskLevel(categoryData.TotalPoints)} | Points: ${categoryData.TotalPoints}\nInfractions:\n${formatInfractions(categoryData.Infractions)}`,
            },
          ],
        },
      );
    }
  });

  return blocks;
}

// ─── Existing test suites ────────────────────────────────────────────

describe("Risk Assessment Functions", () => {
  describe("getRiskLevelEmoji", () => {
    it("returns green for 0-124 points", () => {
      expect(getRiskLevelEmoji(0)).toBe("🟢");
      expect(getRiskLevelEmoji(50)).toBe("🟢");
      expect(getRiskLevelEmoji(124)).toBe("🟢");
    });

    it("returns yellow for 125-249 points", () => {
      expect(getRiskLevelEmoji(125)).toBe("🟡");
      expect(getRiskLevelEmoji(200)).toBe("🟡");
      expect(getRiskLevelEmoji(249)).toBe("🟡");
    });

    it("returns orange for 250-999 points", () => {
      expect(getRiskLevelEmoji(250)).toBe("🟠");
      expect(getRiskLevelEmoji(500)).toBe("🟠");
      expect(getRiskLevelEmoji(999)).toBe("🟠");
    });

    it("returns red for 1000+ points", () => {
      expect(getRiskLevelEmoji(1000)).toBe("🔴");
      expect(getRiskLevelEmoji(5000)).toBe("🔴");
    });
  });

  describe("getRiskLevel", () => {
    it("returns Low for 0-124 points", () => {
      expect(getRiskLevel(0)).toBe("Low");
      expect(getRiskLevel(124)).toBe("Low");
    });

    it("returns Medium for 125-249 points", () => {
      expect(getRiskLevel(125)).toBe("Medium");
      expect(getRiskLevel(249)).toBe("Medium");
    });

    it("returns Review Required for 250-999 points", () => {
      expect(getRiskLevel(250)).toBe("Review Required");
      expect(getRiskLevel(999)).toBe("Review Required");
    });

    it("returns Fail for 1000+ points", () => {
      expect(getRiskLevel(1000)).toBe("Fail");
      expect(getRiskLevel(9999)).toBe("Fail");
    });
  });

  describe("formatInfractions", () => {
    it("returns message for empty infractions", () => {
      expect(formatInfractions([])).toBe("No infractions found.");
      expect(formatInfractions(null)).toBe("No infractions found.");
      expect(formatInfractions(undefined)).toBe("No infractions found.");
    });

    it("formats single infraction", () => {
      const infractions = [
        { RuleText: "Test Rule", RuleOutput: "Test Output", Points: 100 },
      ];
      expect(formatInfractions(infractions)).toBe(
        "- Test Rule: Test Output (100 points)",
      );
    });

    it("omits output when RuleOutput is null", () => {
      const infractions = [
        { RuleText: "Missing Output Rule", RuleOutput: null, Points: 250 },
      ];
      expect(formatInfractions(infractions)).toBe(
        "- Missing Output Rule (250 points)",
      );
    });

    it("formats multiple infractions", () => {
      const infractions = [
        { RuleText: "Rule 1", RuleOutput: "Output 1", Points: 100 },
        { RuleText: "Rule 2", RuleOutput: "Output 2", Points: 200 },
      ];
      const result = formatInfractions(infractions);
      expect(result).toContain("- Rule 1: Output 1 (100 points)");
      expect(result).toContain("- Rule 2: Output 2 (200 points)");
    });
  });
});

describe("Slack Block Building", () => {
  describe("buildSlackBlocks", () => {
    it("builds blocks for medium risk carrier", () => {
      const data = carrierResponse[0];
      const blocks = buildSlackBlocks(data);

      expect(blocks[0].type).toBe("header");
      expect(blocks[0].text.text).toBe("MyCarrierPortal Risk Assessment");

      expect(blocks[1].text.text).toContain("TEST TRUCKING LLC");
      expect(blocks[1].text.text).toContain("DOT: 123456");
      expect(blocks[1].text.text).toContain("MC: MC789012");

      expect(blocks[2].text.text).toContain("🟡");
      expect(blocks[2].text.text).toContain("Medium");
    });

    it("builds blocks for high risk carrier", () => {
      const data = highRiskResponse[0];
      const blocks = buildSlackBlocks(data);

      expect(blocks[1].text.text).toContain("RISKY FREIGHT INC");
      expect(blocks[2].text.text).toContain("🔴");
      expect(blocks[2].text.text).toContain("Fail");

      const categoryBlocks = blocks.filter(
        (b) => b.type === "section" && b.text?.text?.includes("Authority:"),
      );
      expect(categoryBlocks.length).toBe(1);
    });

    it("handles missing data gracefully", () => {
      const data = { CompanyName: null, DotNumber: null, DocketNumber: null };
      const blocks = buildSlackBlocks(data);
      expect(blocks[1].text.text).toContain("N/A");
    });
  });
});

describe("Carrier Response Fixtures", () => {
  it("medium risk fixture has correct structure", () => {
    const data = carrierResponse[0];
    expect(data.CompanyName).toBe("TEST TRUCKING LLC");
    expect(data.RiskAssessmentDetails.TotalPoints).toBe(150);
    expect(data.IsBlocked).toBe(false);
  });

  it("high risk fixture has correct structure", () => {
    const data = highRiskResponse[0];
    expect(data.CompanyName).toBe("RISKY FREIGHT INC");
    expect(data.RiskAssessmentDetails.TotalPoints).toBe(3500);
    expect(data.IsBlocked).toBe(true);
    expect(data.FreightValidateStatus).toBe("Review Recommended");
  });
});

// ─── New test suites ─────────────────────────────────────────────────

describe("formatSlackLinks", () => {
  it("converts HTML anchor tags to Slack links", () => {
    expect(formatSlackLinks('<a href="https://example.com">Click</a>')).toBe(
      "<https://example.com|Click>",
    );
  });
  it("strips non-link HTML tags", () => {
    expect(formatSlackLinks("<b>bold</b>")).toBe("bold");
  });
  it("preserves Slack-native syntax", () => {
    expect(formatSlackLinks("<@U12345>")).toBe("<@U12345>");
    expect(formatSlackLinks("<#C12345>")).toBe("<#C12345>");
  });
  it("handles null/undefined input", () => {
    expect(formatSlackLinks(null)).toBe("");
    expect(formatSlackLinks(undefined)).toBe("");
  });
  it("handles empty string", () => {
    expect(formatSlackLinks("")).toBe("");
  });
});

describe("chunkLines", () => {
  it("returns empty array for empty input", () => {
    expect(chunkLines([])).toEqual([]);
  });
  it("respects maxLines default of 5", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "g"];
    const chunks = chunkLines(lines);
    expect(chunks[0].length).toBe(5);
    expect(chunks[1].length).toBe(2);
  });
  it("respects maxChars limit", () => {
    const longLine = "x".repeat(1000);
    const lines = [longLine, longLine, longLine];
    const chunks = chunkLines(lines, 10, 1800);
    expect(chunks.length).toBeGreaterThan(1);
  });
  it("handles single item", () => {
    expect(chunkLines(["hello"])).toEqual([["hello"]]);
  });
});

describe("Active Assessment Management", () => {
  beforeEach(() => {
    activeAssessments.clear();
  });

  it("returns false for unknown channel", () => {
    expect(hasActiveAssessment("C_UNKNOWN")).toBe(false);
  });

  it("returns true after setting assessment", () => {
    setActiveAssessment("C1", "U1", "12345");
    expect(hasActiveAssessment("C1")).toBe(true);
  });

  it("returns false after clearing assessment", () => {
    setActiveAssessment("C1", "U1", "12345");
    clearActiveAssessment("C1");
    expect(hasActiveAssessment("C1")).toBe(false);
  });

  it("expires after 5 minutes", () => {
    activeAssessments.set("C_OLD", {
      userId: "U1",
      mcNumber: "123",
      startedAt: Date.now() - 6 * 60 * 1000,
    });
    expect(hasActiveAssessment("C_OLD")).toBe(false);
  });
});

describe("buildSessionExpiredView", () => {
  it("returns a valid modal view", () => {
    const view = buildSessionExpiredView();
    expect(view.type).toBe("modal");
    expect(view.title.text).toBe("Session expired");
  });

  it("accepts custom title", () => {
    const view = buildSessionExpiredView("Custom Title");
    expect(view.title.text).toBe("Custom Title");
  });

  it("has a close button but no back button", () => {
    const view = buildSessionExpiredView();
    expect(view.close).toBeDefined();
    const hasBackButton = JSON.stringify(view).includes("wizard_back");
    expect(hasBackButton).toBe(false);
  });
});

describe("generateWizardId", () => {
  it("returns a string starting with wiz_", () => {
    expect(generateWizardId().startsWith("wiz_")).toBe(true);
  });
  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateWizardId()));
    expect(ids.size).toBe(100);
  });
});

describe("Wizard View Builders - null state handling", () => {
  beforeEach(() => {
    wizardState.clear();
  });

  it("buildSessionExpiredView has no back button", () => {
    const view = buildSessionExpiredView();
    const json = JSON.stringify(view);
    expect(json).not.toContain("wizard_back");
  });

  it("buildStep2View returns session expired when state is missing", () => {
    const view = buildStep2View("nonexistent_wizard");
    expect(view.type).toBe("modal");
    const json = JSON.stringify(view).toLowerCase();
    expect(json).toContain("expired");
  });

  it("buildStep3View returns session expired when state is missing", () => {
    const view = buildStep3View("nonexistent_wizard");
    expect(view.type).toBe("modal");
    const json = JSON.stringify(view).toLowerCase();
    expect(json).toContain("expired");
  });

  it("buildStep4View returns session expired when state is missing", () => {
    const view = buildStep4View("nonexistent_wizard");
    expect(view.type).toBe("modal");
    const json = JSON.stringify(view).toLowerCase();
    expect(json).toContain("expired");
  });
});

describe("MC number input normalization", () => {
  // Mirrors the normalization logic in the /risk command handler
  const normalizeMcInput = (text) => text.trim().replace(/^mc/i, "");
  const isValidMcNumber = (mc) => /^\d{1,8}$/.test(mc);

  it("accepts plain numeric input", () => {
    expect(normalizeMcInput("123456")).toBe("123456");
    expect(isValidMcNumber(normalizeMcInput("123456"))).toBe(true);
  });

  it("strips uppercase MC prefix", () => {
    expect(normalizeMcInput("MC123456")).toBe("123456");
    expect(isValidMcNumber(normalizeMcInput("MC123456"))).toBe(true);
  });

  it("strips lowercase mc prefix", () => {
    expect(normalizeMcInput("mc123456")).toBe("123456");
    expect(isValidMcNumber(normalizeMcInput("mc123456"))).toBe(true);
  });

  it("strips mixed-case Mc prefix", () => {
    expect(normalizeMcInput("Mc123456")).toBe("123456");
    expect(isValidMcNumber(normalizeMcInput("Mc123456"))).toBe(true);
  });

  it("trims whitespace around input", () => {
    expect(normalizeMcInput("  MC123456  ")).toBe("123456");
    expect(isValidMcNumber(normalizeMcInput("  MC123456  "))).toBe(true);
  });

  it("rejects non-numeric input after prefix strip", () => {
    expect(isValidMcNumber(normalizeMcInput("MCabc"))).toBe(false);
  });

  it("rejects numbers exceeding 8 digits", () => {
    expect(isValidMcNumber(normalizeMcInput("MC123456789"))).toBe(false);
  });

  it("rejects empty input after trim", () => {
    expect(isValidMcNumber(normalizeMcInput("MC"))).toBe(false);
  });
});
