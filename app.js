require("dotenv").config();
const { sentryConfigured } = require("./sentry-init");
const Sentry = require("@sentry/node");
const { App } = require("@slack/bolt");
const axios = require("axios");
const qs = require("qs");
const { initDb, getTokens, saveTokens, logAuditEntry } = require("./db");
const logger = require("./logger");

// Configurable API URL (default to production)
const CARRIER_API_URL =
  process.env.CARRIER_API_URL || "https://api.mycarrierpackets.com";

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

// Verify required environment variables
if (!BEARER_TOKEN) {
  logger.error("BEARER_TOKEN environment variable is required");
  process.exit(1);
}
if (!REFRESH_TOKEN) {
  logger.error("REFRESH_TOKEN environment variable is required");
  process.exit(1);
}
if (!TOKEN_ENDPOINT_URL) {
  logger.error("TOKEN_ENDPOINT_URL environment variable is required");
  process.exit(1);
}
if (!CLIENT_ID) {
  logger.error("CLIENT_ID environment variable is required");
  process.exit(1);
}
if (!CLIENT_SECRET) {
  logger.error("CLIENT_SECRET environment variable is required");
  process.exit(1);
}
if (!SLACK_SIGNING_SECRET) {
  logger.error("SLACK_SIGNING_SECRET environment variable is required");
  process.exit(1);
}
if (!SLACK_BOT_TOKEN) {
  logger.error("SLACK_BOT_TOKEN environment variable is required");
  process.exit(1);
}
if (!SLACK_APP_TOKEN) {
  logger.error("SLACK_APP_TOKEN environment variable is required");
  process.exit(1);
}

// Track database availability for health checks
let dbAvailable = false;
const VIN_PAGE_SIZE = 10;

const slackApp = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  customRoutes: [
    {
      path: "/health",
      method: ["GET"],
      handler: (req, res) => {
        const health = {
          status: "ok",
          timestamp: new Date().toISOString(),
          socketMode: true,
          database: dbAvailable ? "connected" : "unavailable",
          sentry: sentryConfigured() ? "ok" : "unconfigured",
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
      },
    },
  ],
  installerOptions: {
    port: 3001,
  },
});

// Load tokens from database on startup
async function loadTokens() {
  try {
    await initDb();
    const dbTokens = await getTokens();
    if (dbTokens) {
      logger.info("Loaded tokens from database");
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      // First run - save env tokens to database
      logger.info("No tokens in database, saving from environment");
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
    dbAvailable = true;
  } catch (error) {
    logger.error({ err: error }, "Error loading tokens from database");
    logger.warn("Falling back to environment variables");
    dbAvailable = false;
  }
}

// Redact email for logging — preserves first char and domain for debugging
function redactEmail(email) {
  if (!email || typeof email !== "string") return "[no-email]";
  const parts = email.split("@");
  if (parts.length !== 2) return "[invalid-email]";
  return `${parts[0][0]}***@${parts[1]}`;
}

function getRiskLevelEmoji(points) {
  if (points >= 0 && points <= 124) {
    return "🟢";
  } else if (points >= 125 && points <= 249) {
    return "🟡";
  } else if (points >= 250 && points <= 999) {
    return "🟠";
  } else {
    return "🔴";
  }
}

function getRiskLevel(points) {
  if (points >= 0 && points <= 124) {
    return "Low";
  } else if (points >= 125 && points <= 249) {
    return "Medium";
  } else if (points >= 250 && points <= 999) {
    return "Review Required";
  } else {
    return "Fail";
  }
}

// True only when a numeric risk score is actually present. Guards against
// treating a missing assessment (null/undefined TotalPoints) as a real score,
// which would otherwise fall through to a misleading "Fail (0 pts)" or "Low".
function isRiskPointsAvailable(points) {
  return points !== null && points !== undefined && Number.isFinite(Number(points));
}

// Formats an overall/category risk score for display, or a clear
// "data unavailable" notice when the score is missing.
function formatRiskLevel(points) {
  if (!isRiskPointsAvailable(points)) {
    return "⚠️ Risk data unavailable";
  }
  const pts = Number(points);
  return `${getRiskLevelEmoji(pts)} ${getRiskLevel(pts)} (${pts} pts)`;
}

function normalizeNullableText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  const lower = text.toLowerCase();
  if (lower === "null" || lower === "undefined") return fallback;
  return text;
}

// Normalize a user-entered MC number from a Slack command.
// Strips a leading "MC" token along with any common separators
// (space, hyphen, hash, colon, period) so forms like "MC-1590727",
// "MC 1590727", and "MC#1590727" all reduce to bare digits.
function normalizeMcInput(text) {
  return String(text ?? "")
    .trim()
    .replace(/^mc[\s#:.-]*/i, "");
}

function sanitizeHrefForSlack(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (/^tel:/i.test(trimmed)) {
    const rest = trimmed.slice(4);
    const hasPlus = rest.trimStart().startsWith("+");
    const digits = rest.replace(/\D/g, "");
    return `tel:${hasPlus ? "+" : ""}${digits}`;
  }
  return trimmed;
}

function formatSlackLinks(text) {
  const input = normalizeNullableText(text, "");
  if (!input) return "";
  const withSlackLinks = input.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,
    (_match, url, label) => `<${sanitizeHrefForSlack(url)}|${label}>`,
  );
  return withSlackLinks.replace(/<([^>\s]+)([^>]*)>/g, (match, token) => {
    const lower = token.toLowerCase();
    if (
      lower.startsWith("http") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("@") ||
      lower.startsWith("#") ||
      lower.startsWith("!")
    ) {
      return match;
    }
    return "";
  });
}

function formatInfractionLine(infraction) {
  const ruleText = normalizeNullableText(
    infraction?.RuleText,
    "Unknown infraction",
  );
  const output = formatSlackLinks(infraction?.RuleOutput);
  const points = infraction?.Points ?? "N/A";
  if (output) {
    return `- ${ruleText}: ${output} (${points} pts)`;
  }
  return `- ${ruleText} (${points} pts)`;
}

function chunkLines(lines, maxLines = 5, maxChars = 1800) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  lines.forEach((line) => {
    const lineText = String(line);
    const lineLength = lineText.length + (current.length > 0 ? 1 : 0);
    const exceedsChars = currentLength + lineLength > maxChars;
    const exceedsLines = current.length >= maxLines;

    if (current.length > 0 && (exceedsChars || exceedsLines)) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(lineText);
    currentLength += lineText.length + (current.length > 1 ? 1 : 0);
  });

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// In-memory wizard state storage (keyed by view_id or user_id + mc_number)
const wizardState = new Map();

// Active assessment tracking per channel (prevents concurrent wizard sessions)
const activeAssessments = new Map();

// Check if channel has active assessment
function hasActiveAssessment(channelId) {
  const active = activeAssessments.get(channelId);
  if (!active) return false;
  // Expire after 5 minutes to prevent stuck states
  if (Date.now() - active.startedAt > 5 * 60 * 1000) {
    activeAssessments.delete(channelId);
    return false;
  }
  return true;
}

// Set active assessment for channel
function setActiveAssessment(channelId, userId, mcNumber) {
  activeAssessments.set(channelId, { userId, mcNumber, startedAt: Date.now() });
}

// Clear active assessment for channel
function clearActiveAssessment(channelId) {
  activeAssessments.delete(channelId);
}

// API call function with token refresh
async function apiCall(endpoint, params = {}, method = "POST") {
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      const config = {
        method,
        url: `${CARRIER_API_URL}${endpoint}`,
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      };

      // MyCarrierPackets API expects all parameters as query strings
      config.params = params;

      const logParams = params.carrierEmail
        ? { ...params, carrierEmail: redactEmail(params.carrierEmail) }
        : params;
      logger.info(
        { endpoint, params: logParams, attempt: attempt + 1 },
        "Making API call",
      );
      const response = await axios(config);
      return { success: true, data: response.data };
    } catch (error) {
      if (error.response?.status === 401 && attempt < maxAttempts - 1) {
        logger.warn({ endpoint }, "Token expired, attempting refresh");
        const refreshed = await refreshAccessToken();
        if (refreshed.success) {
          attempt++;
          continue;
        }
      }
      logger.error(
        { err: error, endpoint, responseData: error.response?.data },
        "API call failed",
      );
      // 404s are expected for invalid DOT numbers — don't page Sentry on them
      if (error.response?.status !== 404) {
        const safeResponse = {
          status: error.response?.status,
          code: error.response?.data?.code,
          message: error.response?.data?.message,
        };
        Sentry.captureException(error, {
          tags: { endpoint, status: error.response?.status },
          extra: { response: safeResponse },
        });
      }
      return {
        success: false,
        error: error.response?.status === 404 ? "not_found" : "api_error",
        message: error.response?.data?.message || error.message,
      };
    }
  }
  return {
    success: false,
    error: "max_retries",
    message: "Max retries reached",
  };
}

// Fetch carrier data by calling GetCarrierData + GetCarrierRiskAssessment in parallel
async function fetchCarrierData(mcNumber) {
  const [profileResult, riskResult] = await Promise.all([
    apiCall("/api/v1/Carrier/GetCarrierData", { DocketNumber: mcNumber }),
    apiCall("/api/v1/Carrier/GetCarrierRiskAssessment", {
      docketNumber: mcNumber,
    }),
  ]);

  // If both failed, return error
  if (!profileResult.success && !riskResult.success) {
    return profileResult; // Return first error
  }

  // Merge the data
  const profile = profileResult.success
    ? profileResult.data?.AssureAdvantage?.[0]?.CarrierDetails
    : null;
  const riskData = riskResult.success
    ? Array.isArray(riskResult.data)
      ? riskResult.data[0]
      : riskResult.data
    : null;

  // Build merged carrier object
  const merged = {
    // From GetCarrierData profile
    CompanyName: profile?.Identity?.legalName || "Unknown Carrier",
    DBAName: profile?.Identity?.dbaName || null,
    DotNumber: profile?.dotNumber?.Value || riskData?.DOTNumber || "N/A",
    DocketNumber: profile?.docketNumber || riskData?.DocketNumber || mcNumber,
    TrucksTotal: profile?.Equipment?.trucksTotal ?? "N/A",
    DriversTotal: profile?.Drivers?.driversTotal ?? "N/A",
    PowerUnits: profile?.Equipment?.totalPower ?? "N/A",
    Phone: profile?.Identity?.businessPhone || "N/A",
    City: profile?.Identity?.businessCity || "N/A",
    State: profile?.Identity?.businessState || "N/A",
    AuthorityStatus: profile?.Authority?.commonAuthority || "N/A",
    AuthGrantDate: profile?.Authority?.authGrantDate || "N/A",
    IsBlocked: profile?.isBlocked || riskData?.IsBlocked || false,
    IsMonitored: profile?.isMonitored || false,
    FreightValidateStatus: riskData?.FreightValidateStatus || null,
    // From GetCarrierRiskAssessment
    RiskAssessmentDetails: riskData?.RiskAssessmentDetails || null,
    // Raw data for later steps
    _profile: profile,
    _riskData: riskData,
  };

  return { success: true, data: merged };
}

// Fetch carrier incident reports
async function fetchCarrierIncidentReports(mcNumber) {
  return apiCall("/api/v1/Carrier/GetCarrierIncidentReports", {
    docketNumber: mcNumber,
  });
}

// Fetch carrier VIN verifications
async function fetchCarrierVINVerifications(mcNumber) {
  return apiCall("/api/v1/Carrier/GetCarrierVINVerifications", {
    docketNumber: mcNumber,
  });
}

// Fetch carrier contacts
async function fetchCarrierContacts(mcNumber) {
  return apiCall("/api/v1/Carrier/GetCarrierContacts", {
    docketNumber: mcNumber,
  });
}

// Send Intellivite invitation
async function sendIntellivite(mcNumber, email) {
  return apiCall("/api/v1/Carrier/EmailPacketInvitation", {
    docketNumber: mcNumber,
    carrierEmail: email,
  });
}

// Generate unique wizard session ID
function generateWizardId() {
  return `wiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function buildLoadingView(mcNumber, channelId = null) {
  return {
    type: "modal",
    callback_id: "carrier_wizard_loading",
    notify_on_close: true,
    private_metadata: JSON.stringify({ mcNumber, channelId }),
    title: { type: "plain_text", text: "Carrier Assessment", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: Loading carrier data for MC${mcNumber}...`,
        },
      },
    ],
  };
}

function buildSessionExpiredView(titleText = "Session expired") {
  return {
    type: "modal",
    callback_id: "carrier_wizard",
    title: { type: "plain_text", text: titleText, emoji: true },
    close: { type: "plain_text", text: "Close", emoji: true },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Session expired. Please start a new assessment.",
        },
      },
    ],
  };
}

// Build Block Kit blocks for channel broadcast when assessment starts
function buildChannelAssessmentBlocks(carrierData, mcNumber, userId) {
  const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
  const risk = data.RiskAssessmentDetails || {};
  const companyName = normalizeNullableText(
    data.CompanyName,
    "Unknown Carrier",
  );
  const dotNumber = normalizeNullableText(data.DotNumber, "N/A");
  const docketNumber = normalizeNullableText(data.DocketNumber, "N/A");
  const trucksTotal = normalizeNullableText(data.TrucksTotal, "N/A");
  const driversTotal = normalizeNullableText(data.DriversTotal, "N/A");

  const riskAvailable = isRiskPointsAvailable(risk.TotalPoints);
  const totalPoints = riskAvailable ? Number(risk.TotalPoints) : null;
  const overallText = riskAvailable
    ? `${getRiskLevelEmoji(totalPoints)} *Risk Assessment: ${getRiskLevel(totalPoints)}* (${totalPoints} pts)`
    : "⚠️ *Risk Assessment: Data unavailable*";

  const categories = ["Authority", "Insurance", "Operation", "Safety", "Other"];
  const categoryLine = categories
    .filter((cat) => risk[cat])
    .map((cat) => {
      const pts = risk[cat].TotalPoints || 0;
      return `${cat} ${getRiskLevelEmoji(pts)} ${pts}`;
    })
    .join("  ·  ");

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<@${userId}> is reviewing *${companyName}*`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*MC:* ${docketNumber}` },
        { type: "mrkdwn", text: `*DOT:* ${dotNumber}` },
        { type: "mrkdwn", text: `*Trucks:* ${trucksTotal}` },
        { type: "mrkdwn", text: `*Drivers:* ${driversTotal}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: overallText,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: categoryLine || "No risk data available",
        },
      ],
    },
  ];
}

// Build Step 1: Assessment Overview modal
function buildStep1View(carrierData, mcNumber, channelId, wizardId = null) {
  const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
  const risk = data.RiskAssessmentDetails || {};
  const companyName = normalizeNullableText(
    data.CompanyName,
    "Unknown Carrier",
  );
  const dbaName = normalizeNullableText(data.DBAName, "");
  const dotNumber = normalizeNullableText(data.DotNumber, "N/A");
  const docketNumber = normalizeNullableText(data.DocketNumber, "N/A");
  const trucksTotal = normalizeNullableText(data.TrucksTotal, "N/A");
  const driversTotal = normalizeNullableText(data.DriversTotal, "N/A");
  const city = normalizeNullableText(data.City, "N/A");
  const state = normalizeNullableText(data.State, "N/A");
  const authorityStatus = normalizeNullableText(data.AuthorityStatus, "N/A");

  // Generate wizard ID if not provided (first call) and store data in memory
  const wId = wizardId || generateWizardId();
  if (!wizardId) {
    wizardState.set(wId, { carrierData: data, mcNumber, channelId });
  }

  // Build company name with DBA if present
  const companyDisplay = dbaName
    ? `*${companyName}*\n_DBA: ${dbaName}_`
    : `*${companyName}*`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${companyDisplay}\nDOT: ${dotNumber} | MC: ${docketNumber}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Trucks:*\n${trucksTotal}`,
        },
        {
          type: "mrkdwn",
          text: `*Drivers:*\n${driversTotal}`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Location:*\n${city}, ${state}`,
        },
        {
          type: "mrkdwn",
          text: `*Authority:*\n${authorityStatus}`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: "*Overall Risk Assessment:*",
        },
        {
          type: "mrkdwn",
          text: formatRiskLevel(risk.TotalPoints),
        },
      ],
    },
    { type: "divider" },
  ];

  // Risk categories - compact summary (details available in Step 2)
  const categories = ["Authority", "Insurance", "Operation", "Safety", "Other"];
  const riskFields = categories
    .filter((category) => risk[category])
    .map((category) => {
      const categoryData = risk[category];
      const infractionCount = categoryData.Infractions?.length || 0;
      const countText = infractionCount > 0 ? ` (${infractionCount})` : "";
      return [
        {
          type: "mrkdwn",
          text: `*${category}:*`,
        },
        {
          type: "mrkdwn",
          text: `${formatRiskLevel(categoryData.TotalPoints)}${countText}`,
        },
      ];
    })
    .flat();

  if (riskFields.length > 0) {
    blocks.push({
      type: "section",
      fields: riskFields,
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No risk data available",
      },
    });
  }

  // MyCarrierProtect section if applicable
  if (data.IsBlocked || data.FreightValidateStatus === "Review Recommended") {
    blocks.push({ type: "divider" });
    const mcpWarnings = [];
    if (data.IsBlocked) {
      mcpWarnings.push("Blocked by 3+ companies");
    }
    if (data.FreightValidateStatus === "Review Recommended") {
      mcpWarnings.push("FreightValidate: Review Recommended");
    }
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*MyCarrierProtect:* ${getRiskLevelEmoji(1000)} Review Required\n${mcpWarnings.map((w) => `  - ${w}`).join("\n")}`,
      },
    });
  }

  // Navigation buttons
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Decline", emoji: true },
          action_id: "wizard_decline",
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Next \u2192", emoji: true },
          action_id: "wizard_next",
          style: "primary",
        },
      ],
    },
  );

  return {
    type: "modal",
    callback_id: "carrier_wizard",
    notify_on_close: true,
    private_metadata: JSON.stringify({ wizardId: wId, step: 1 }),
    title: { type: "plain_text", text: "Carrier Assessment", emoji: true },
    blocks,
  };
}

// Build Step 2: Detailed Risk Information modal
function buildStep2View(wizardId, incidentReports, options = {}) {
  const state = wizardState.get(wizardId);
  if (!state) {
    return buildSessionExpiredView("Risk Details");
  }
  if (!incidentReports) {
    incidentReports = state.incidentReports || [];
  }
  const { carrierData } = state;
  const risk = carrierData.RiskAssessmentDetails || {};
  const companyName = normalizeNullableText(
    carrierData.CompanyName,
    "Unknown Carrier",
  );

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${companyName}* - Detailed Risk Information`,
      },
    },
    { type: "divider" },
  ];

  if (options.loadError) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":warning: *Some data could not be loaded. Results may be incomplete.*",
      },
    });
  }

  // Incident reports section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*Incident Reports:*",
    },
  });

  if (incidentReports && incidentReports.length > 0) {
    incidentReports.slice(0, 5).forEach((report) => {
      const incidentType = normalizeNullableText(
        report.IncidentType || report.Type,
        "Incident",
      );
      const incidentDetails = normalizeNullableText(
        report.Description || report.Details,
        "No details",
      );
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `- ${incidentType}: ${incidentDetails}`,
          },
        ],
      });
    });
    if (incidentReports.length > 5) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `...and ${incidentReports.length - 5} more incidents`,
          },
        ],
      });
    }
  } else {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "No incident reports found." }],
    });
  }

  blocks.push({ type: "divider" });

  // Detailed infractions by category
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*All Infractions by Category:*" },
  });

  const categories = ["Authority", "Insurance", "Operation", "Safety", "Other"];
  categories.forEach((category) => {
    const categoryData = risk[category];
    if (categoryData?.Infractions?.length > 0) {
      const infractionLines =
        categoryData.Infractions.map(formatInfractionLine).filter(Boolean);
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${category}:*`,
        },
      });
      chunkLines(infractionLines).forEach((chunk) => {
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: chunk.join("\n"),
            },
          ],
        });
      });
    }
  });

  // Navigation buttons
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Decline", emoji: true },
          action_id: "wizard_decline",
          style: "danger",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Next \u2192", emoji: true },
          action_id: "wizard_next",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "\u2190 Back", emoji: true },
          action_id: "wizard_back",
        },
      ],
    },
  );

  return {
    type: "modal",
    callback_id: "carrier_wizard",
    notify_on_close: true,
    private_metadata: JSON.stringify({ wizardId, step: 2 }),
    title: { type: "plain_text", text: "Risk Details", emoji: true },
    blocks,
  };
}

// Build Step 3: Vehicle Information modal
function buildStep3View(wizardId, options = {}) {
  const state = wizardState.get(wizardId);
  if (!state) {
    return buildSessionExpiredView("Vehicles");
  }
  const { carrierData } = state;
  const companyName = normalizeNullableText(
    carrierData.CompanyName,
    "Unknown Carrier",
  );
  const vinVerifications =
    options.vinVerifications || state.vinVerifications || [];
  const pageSize = options.pageSize ?? state.vinPageSize ?? VIN_PAGE_SIZE;
  const totalCount = vinVerifications.length;
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;
  const requestedPage = options.page ?? state.vinPage ?? 0;
  const page =
    totalPages > 0 ? Math.min(Math.max(requestedPage, 0), totalPages - 1) : 0;

  state.vinPage = page;
  state.vinPageSize = pageSize;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${companyName}* - Vehicle Information`,
      },
    },
    { type: "divider" },
  ];

  if (options.loadError) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":warning: *Some data could not be loaded. Results may be incomplete.*",
      },
    });
  }

  if (vinVerifications && vinVerifications.length > 0) {
    const pageLabel = totalPages > 1 ? ` (Page ${page + 1}/${totalPages})` : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Verified Vehicles:* ${vinVerifications.length} total${pageLabel}`,
      },
    });

    const startIndex = page * pageSize;
    const pageItems = vinVerifications.slice(startIndex, startIndex + pageSize);
    pageItems.forEach((vin) => {
      const status = normalizeNullableText(
        vin.VINVerificationStatus?.Description,
        "Unknown",
      );
      const vinValue = normalizeNullableText(vin.VIN, "N/A");
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `VIN: \`${vinValue}\` | Status: ${status}`,
          },
        ],
      });
    });

    if (totalPages > 1) {
      const paginationElements = [];
      if (page > 0) {
        paginationElements.push({
          type: "button",
          text: { type: "plain_text", text: "← Prev", emoji: true },
          action_id: "wizard_vins_prev",
        });
      }
      if (page < totalPages - 1) {
        paginationElements.push({
          type: "button",
          text: { type: "plain_text", text: "Next →", emoji: true },
          action_id: "wizard_vins_next",
        });
      }
      if (paginationElements.length > 0) {
        blocks.push({
          type: "actions",
          block_id: "vin_pagination",
          elements: paginationElements,
        });
      }
    }
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "No verified vehicles found for this carrier.",
      },
    });
  }

  // Navigation buttons
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "\u2190 Back", emoji: true },
          action_id: "wizard_back",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Next \u2192", emoji: true },
          action_id: "wizard_next",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Decline", emoji: true },
          action_id: "wizard_decline",
          style: "danger",
        },
      ],
    },
  );

  return {
    type: "modal",
    callback_id: "carrier_wizard",
    notify_on_close: true,
    private_metadata: JSON.stringify({
      wizardId,
      step: 3,
      vinPage: page,
      vinPageSize: pageSize,
    }),
    title: { type: "plain_text", text: "Vehicles", emoji: true },
    blocks,
  };
}

// Build Step 4: Contacts & Intellivite modal
function buildStep4View(wizardId, contacts = [], options = {}) {
  const state = wizardState.get(wizardId);
  if (!state) {
    return buildSessionExpiredView("Contacts");
  }
  const { carrierData } = state;
  const companyName = normalizeNullableText(
    carrierData.CompanyName,
    "Unknown Carrier",
  );

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${companyName}* - Send Intellivite`,
      },
    },
    { type: "divider" },
  ];

  if (options.loadError) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":warning: *Some data could not be loaded. Results may be incomplete.*",
      },
    });
  }

  // Contact selection - API returns FirstName, LastName, Email
  // Slack caps option values at 75 chars, so we store a short option ID and
  // resolve it back to the full email from wizard state on selection. Storing
  // the (possibly >75 char) email directly as the value would truncate it and
  // send the invite to the wrong address.
  const contactEmails = {};
  const contactOptions = (contacts || [])
    .slice(0, 10)
    .filter((c) => normalizeNullableText(c.Email, ""))
    .map((contact, index) => {
      const firstName = normalizeNullableText(contact.FirstName, "");
      const lastName = normalizeNullableText(contact.LastName, "");
      const fullName = [firstName, lastName].filter(Boolean).join(" ");
      const fallbackName = normalizeNullableText(
        contact.Name || contact.ContactName,
        "Unknown",
      );
      const name = fullName || fallbackName;
      const email = normalizeNullableText(contact.Email, "");
      const label = `${name} - ${email}`.slice(0, 75);
      const optionId = `contact_${index}`;
      contactEmails[optionId] = email;
      return {
        text: {
          type: "plain_text",
          text: label,
        },
        value: optionId,
      };
    });
  // Persist the id→email map (mutates the object held in wizardState).
  state.contactEmails = contactEmails;

  if (contactOptions.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*Select a verified contact:*" },
      accessory: {
        type: "static_select",
        placeholder: { type: "plain_text", text: "Choose contact" },
        action_id: "select_contact",
        options: contactOptions,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No verified contacts with email found." },
    });
  }

  blocks.push({ type: "divider" });

  // Manual email input
  blocks.push({
    type: "input",
    block_id: "manual_email_block",
    element: {
      type: "plain_text_input",
      action_id: "manual_email_input",
      placeholder: { type: "plain_text", text: "contact@carrier.com" },
    },
    label: { type: "plain_text", text: "Or enter email manually:" },
    hint: {
      type: "plain_text",
      text: "MCP will verify phone number on their end.",
    },
    optional: true,
  });

  // Navigation buttons (Back and Decline only - Submit handled by modal submit)
  blocks.push(
    { type: "divider" },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "\u2190 Back", emoji: true },
          action_id: "wizard_back",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Decline", emoji: true },
          action_id: "wizard_decline",
          style: "danger",
        },
      ],
    },
  );

  return {
    type: "modal",
    callback_id: "carrier_wizard_step4",
    notify_on_close: true,
    submit: { type: "plain_text", text: "Send Intellivite" },
    close: { type: "plain_text", text: "Cancel" },
    private_metadata: JSON.stringify({ wizardId, step: 4 }),
    title: { type: "plain_text", text: "Send Invite", emoji: true },
    blocks,
  };
}

let refreshPromise = null;

async function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = _doRefreshAccessToken();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// Applies a token-endpoint response: validates, updates in-memory state,
// and persists to the database (DB failure does not invalidate the refresh).
async function _applyTokenResponse(responseData, context) {
  const newAccessToken = responseData.access_token;
  const newRefreshToken = responseData.refresh_token;

  if (!newAccessToken) {
    throw new Error("access_token missing from token endpoint response");
  }

  BEARER_TOKEN = newAccessToken;

  let newRefreshIssued = false;
  if (newRefreshToken) {
    REFRESH_TOKEN = newRefreshToken;
    newRefreshIssued = true;
  }

  try {
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
  } catch (dbError) {
    logger.error(
      {
        err: dbError,
        context,
        tokenRefreshSucceeded: true,
        newRefreshIssued,
      },
      "Failed to persist tokens to database - in-memory tokens remain valid",
    );
  }

  return newRefreshIssued;
}

// Re-auth via password grant using CLIENT_ID/CLIENT_SECRET as username/password.
// MyCarrierPackets confirmed (per thoughts/shared/research/2025-12-30) these are
// account credentials, not OAuth2 client creds — used to bootstrap a fresh
// refresh_token when the current one is revoked/expired.
async function _passwordGrantReauth() {
  const data = qs.stringify({
    grant_type: "password",
    username: CLIENT_ID,
    password: CLIENT_SECRET,
  });

  const response = await axios.post(TOKEN_ENDPOINT_URL, data, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!response.data.refresh_token) {
    throw new Error("refresh_token missing from password grant response");
  }

  return _applyTokenResponse(response.data, "passwordGrantReauth");
}

async function _doRefreshAccessToken() {
  logger.info("Attempting to refresh access token...");
  try {
    const data = qs.stringify({
      grant_type: "refresh_token",
      refresh_token: REFRESH_TOKEN,
    });

    const response = await axios.post(TOKEN_ENDPOINT_URL, data, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const newRefreshIssued = await _applyTokenResponse(
      response.data,
      "refreshAccessToken",
    );

    logger.info({ newRefreshIssued }, "Access token refreshed successfully.");
    if (!newRefreshIssued) {
      logger.warn(
        "New refresh token was not provided in the response. Old refresh token will be reused.",
      );
    }

    return { success: true, newRefreshIssued, usedPasswordFallback: false };
  } catch (error) {
    const isInvalidGrant =
      error.response?.status === 400 &&
      error.response?.data?.error === "invalid_grant";

    if (isInvalidGrant) {
      logger.warn(
        { responseData: error.response.data },
        "Refresh token rejected as invalid_grant — attempting password-grant self-heal",
      );
      try {
        await _passwordGrantReauth();
        logger.warn(
          { usedPasswordFallback: true },
          "Access token refreshed via password-grant fallback. Upstream refresh token was invalid or expired; a new pair has been persisted.",
        );
        return {
          success: true,
          newRefreshIssued: true,
          usedPasswordFallback: true,
        };
      } catch (fallbackError) {
        logger.error(
          {
            err: fallbackError,
            responseData: fallbackError.response
              ? fallbackError.response.data
              : undefined,
          },
          "Password-grant fallback failed. Manual intervention required.",
        );
        return {
          success: false,
          newRefreshIssued: false,
          usedPasswordFallback: true,
        };
      }
    }

    logger.error(
      {
        err: error,
        responseData: error.response ? error.response.data : undefined,
      },
      "Error refreshing access token",
    );
    return {
      success: false,
      newRefreshIssued: false,
      usedPasswordFallback: false,
    };
  }
}

// /risk command - Opens carrier assessment wizard modal
slackApp.command("/risk", async ({ command, ack, respond, client }) => {
  await ack();

  const { text, channel_id, trigger_id, user_id } = command;

  if (!text) {
    await respond({
      text: "Please provide a valid MC number.",
      response_type: "ephemeral",
    });
    return;
  }

  const mcNumber = normalizeMcInput(text);

  if (!/^\d{1,8}$/.test(mcNumber)) {
    await respond({
      text: "Please provide a valid MC number (e.g., 123456 or MC123456).",
      response_type: "ephemeral",
    });
    return;
  }

  // Check for concurrent assessment in this channel
  if (hasActiveAssessment(channel_id)) {
    const active = activeAssessments.get(channel_id);
    await respond({
      text: `Another carrier assessment (MC${active.mcNumber}) is in progress. Please try again shortly.`,
      response_type: "ephemeral",
    });
    return;
  }

  logger.info({ mcNumber, userId: user_id }, "Starting carrier wizard");

  // Open loading modal immediately for responsive UX
  let loadingViewId;
  try {
    const loadingResult = await client.views.open({
      trigger_id,
      view: buildLoadingView(mcNumber, channel_id),
    });
    loadingViewId = loadingResult.view.id;
    setActiveAssessment(channel_id, user_id, mcNumber);
  } catch (error) {
    logger.error({ err: error, mcNumber }, "Failed to open loading modal");
    await respond({
      text: "Failed to open carrier assessment. Please try again.",
      response_type: "ephemeral",
    });
    return;
  }

  // Fetch carrier data using GetCarrierData endpoint
  const result = await fetchCarrierData(mcNumber);

  if (!result.success) {
    let errorMessage =
      "Error fetching carrier data. Please close this modal and try again.";
    if (result.error === "not_found") {
      errorMessage = `Carrier MC${mcNumber} not found in MCP database.`;
    } else if (result.error === "api_error") {
      errorMessage =
        "An API error occurred. Please close this modal and try again.";
      logger.error({ message: result.message }, "API error details");
    }
    clearActiveAssessment(channel_id);
    // The user may have already cancelled the loading modal; updating a view
    // that no longer exists rejects, and the global unhandledRejection handler
    // would take the whole process down. Swallow that here.
    try {
      await client.views.update({
        view_id: loadingViewId,
        view: buildSessionExpiredView("Error"),
      });
    } catch (updateError) {
      logger.warn(
        { err: updateError, mcNumber },
        "Failed to update loading modal with error view (likely already closed)",
      );
    }
    // Also send ephemeral so user sees the specific error
    await respond({ text: errorMessage, response_type: "ephemeral" });
    return;
  }

  const carrierData = result.data;
  if (
    !carrierData ||
    (Array.isArray(carrierData) && carrierData.length === 0)
  ) {
    clearActiveAssessment(channel_id);
    try {
      await client.views.update({
        view_id: loadingViewId,
        view: buildSessionExpiredView("No Data"),
      });
    } catch (updateError) {
      logger.warn(
        { err: updateError, mcNumber },
        "Failed to update loading modal with no-data view (likely already closed)",
      );
    }
    await respond({
      text: "No data found for the provided MC number.",
      response_type: "ephemeral",
    });
    return;
  }

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
      const headerRisk = isRiskPointsAvailable(risk.TotalPoints)
        ? `${getRiskLevelEmoji(Number(risk.TotalPoints))} ${getRiskLevel(Number(risk.TotalPoints))}`
        : "⚠️ Risk data unavailable";
      await respond({
        response_type: "in_channel",
        replace_original: false,
        text: `<@${user_id}> is reviewing ${carrierName} (MC${mcNumber}) - ${headerRisk}`,
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
});

// Handle wizard navigation - Next button
slackApp.action("wizard_next", async ({ ack, body, client }) => {
  await ack();

  let wizardId, step;
  try {
    ({ wizardId, step } = JSON.parse(body.view.private_metadata));
  } catch (parseError) {
    logger.warn(
      { err: parseError },
      "Failed to parse private_metadata in wizard_next",
    );
    return;
  }

  const state = wizardState.get(wizardId);
  if (!state) {
    logger.warn({ wizardId, step }, "Wizard state missing on next action");
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }

  const { mcNumber } = state;
  const userId = body.user.id;

  logger.info({ mcNumber, step, userId }, "Wizard next clicked");

  let newView;

  if (step === 1) {
    const incidentResult = await fetchCarrierIncidentReports(mcNumber);
    const loadError = !incidentResult.success;
    if (loadError) {
      logger.warn(
        { mcNumber },
        "Failed to load incident reports for wizard step 2",
      );
    }
    const incidentReports = incidentResult.success
      ? incidentResult.data?.IncidentReports || []
      : [];
    state.incidentReports = incidentReports;
    newView = buildStep2View(wizardId, incidentReports, { loadError });
  } else if (step === 2) {
    const vinResult = await fetchCarrierVINVerifications(mcNumber);
    const loadError = !vinResult.success;
    if (loadError) {
      logger.warn(
        { mcNumber },
        "Failed to load VIN verifications for wizard step 3",
      );
    }
    const vinVerifications = vinResult.success
      ? vinResult.data?.VINVerifications || []
      : [];
    state.vinVerifications = vinVerifications;
    state.vinPage = 0;
    state.vinPageSize = VIN_PAGE_SIZE;
    newView = buildStep3View(wizardId, {
      vinVerifications,
      page: 0,
      pageSize: VIN_PAGE_SIZE,
      loadError,
    });
  } else if (step === 3) {
    const contactsResult = await fetchCarrierContacts(mcNumber);
    const loadError = !contactsResult.success;
    if (loadError) {
      logger.warn({ mcNumber }, "Failed to load contacts for wizard step 4");
    }
    const contacts = contactsResult.success
      ? contactsResult.data?.Carrier?.Contacts || []
      : [];
    newView = buildStep4View(wizardId, contacts, { loadError });
  }

  if (newView) {
    try {
      await client.views.update({
        view_id: body.view.id,
        view: newView,
      });
    } catch (error) {
      logger.error(
        { err: error, mcNumber, step },
        "Failed to update modal view",
      );
    }
  }
});

// Handle wizard navigation - Back button
slackApp.action("wizard_back", async ({ ack, body, client }) => {
  await ack();

  let wizardId, step;
  try {
    ({ wizardId, step } = JSON.parse(body.view.private_metadata));
  } catch (parseError) {
    logger.warn(
      { err: parseError },
      "Failed to parse private_metadata in wizard_back",
    );
    return;
  }
  const state = wizardState.get(wizardId);
  if (!state) {
    logger.warn({ wizardId, step }, "Wizard state missing on back action");
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }
  const { mcNumber, channelId, carrierData } = state;
  const userId = body.user.id;

  logger.info({ mcNumber, step, userId }, "Wizard back clicked");

  let newView;

  if (step === 2) {
    newView = buildStep1View(carrierData, mcNumber, channelId, wizardId);
  } else if (step === 3) {
    newView = buildStep2View(wizardId);
  } else if (step === 4) {
    newView = buildStep3View(wizardId);
  }

  if (newView) {
    try {
      await client.views.update({
        view_id: body.view.id,
        view: newView,
      });
    } catch (error) {
      logger.error({ err: error, step }, "Failed to go back in modal");
    }
  }
});

// Handle VIN pagination - Next
slackApp.action("wizard_vins_next", async ({ ack, body, client }) => {
  await ack();

  const metadata = JSON.parse(body.view.private_metadata || "{}");
  const { wizardId, vinPage = 0, vinPageSize = VIN_PAGE_SIZE } = metadata;
  const state = wizardState.get(wizardId);

  if (!state || !Array.isArray(state.vinVerifications)) {
    logger.warn({ wizardId }, "VIN pagination requested without session");
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView("Vehicles"),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(state.vinVerifications.length / vinPageSize),
  );
  const nextPage = Math.min(vinPage + 1, totalPages - 1);
  state.vinPage = nextPage;
  state.vinPageSize = vinPageSize;

  const newView = buildStep3View(wizardId, {
    vinVerifications: state.vinVerifications,
    page: nextPage,
    pageSize: vinPageSize,
  });

  try {
    await client.views.update({
      view_id: body.view.id,
      view: newView,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to update VIN pagination view");
  }
});

// Handle VIN pagination - Prev
slackApp.action("wizard_vins_prev", async ({ ack, body, client }) => {
  await ack();

  const metadata = JSON.parse(body.view.private_metadata || "{}");
  const { wizardId, vinPage = 0, vinPageSize = VIN_PAGE_SIZE } = metadata;
  const state = wizardState.get(wizardId);

  if (!state || !Array.isArray(state.vinVerifications)) {
    logger.warn({ wizardId }, "VIN pagination requested without session");
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView("Vehicles"),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(state.vinVerifications.length / vinPageSize),
  );
  const prevPage = Math.max(vinPage - 1, 0);
  const clampedPage = Math.min(prevPage, totalPages - 1);
  state.vinPage = clampedPage;
  state.vinPageSize = vinPageSize;

  const newView = buildStep3View(wizardId, {
    vinVerifications: state.vinVerifications,
    page: clampedPage,
    pageSize: vinPageSize,
  });

  try {
    await client.views.update({
      view_id: body.view.id,
      view: newView,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to update VIN pagination view");
  }
});

// Handle wizard decline
slackApp.action("wizard_decline", async ({ ack, body, client }) => {
  await ack();

  let wizardId;
  try {
    ({ wizardId } = JSON.parse(body.view.private_metadata));
  } catch (parseError) {
    logger.warn(
      { err: parseError },
      "Failed to parse private_metadata in wizard_decline",
    );
    return;
  }

  const state = wizardState.get(wizardId);
  if (!state) {
    logger.warn({ wizardId }, "Wizard state missing on decline action");
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }

  const { mcNumber, channelId, carrierData } = state;
  const userId = body.user.id;

  logger.info({ mcNumber, userId }, "Carrier declined");

  // Clear active assessment and wizard state
  clearActiveAssessment(channelId);
  wizardState.delete(`${wizardId}_selected_email`);
  wizardState.delete(wizardId);

  // Log to audit
  try {
    await logAuditEntry(userId, mcNumber, "decline");
  } catch (error) {
    logger.error({ err: error }, "Failed to log audit entry");
  }

  // Post decline message to channel
  try {
    const carrierName = normalizeNullableText(
      carrierData?.CompanyName,
      "Unknown Carrier",
    );
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> voted no on ${carrierName} (MC${mcNumber})`,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to post decline message");
  }

  // Close modal
  try {
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Declined" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Carrier assessment declined. Message posted to channel.",
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to close modal after decline");
  }
});

// Handle contact selection
slackApp.action("select_contact", async ({ ack, body }) => {
  await ack();
  const selectedValue = body.actions[0].selected_option?.value;
  if (selectedValue) {
    let wizardId;
    try {
      ({ wizardId } = JSON.parse(body.view.private_metadata));
    } catch (parseError) {
      logger.warn(
        { err: parseError },
        "Failed to parse private_metadata in select_contact",
      );
      return;
    }
    // Resolve the short option ID back to the full (untruncated) email.
    // Fall back to the raw value for backward compatibility with any older view.
    const state = wizardState.get(wizardId);
    const selectedEmail = state?.contactEmails?.[selectedValue] || selectedValue;
    const stateKey = `${wizardId}_selected_email`;
    wizardState.set(stateKey, selectedEmail);
    logger.info(
      { userId: body.user.id, selectedEmail: redactEmail(selectedEmail) },
      "Contact selected",
    );
  }
});

// Handle Send Intellivite
slackApp.action("wizard_send_intellivite", async ({ ack, body, client }) => {
  await ack();

  let wizardId;
  try {
    ({ wizardId } = JSON.parse(body.view.private_metadata));
  } catch (parseError) {
    logger.warn(
      { err: parseError },
      "Failed to parse private_metadata in wizard_send_intellivite",
    );
    return;
  }

  const state = wizardState.get(wizardId);
  if (!state) {
    logger.warn(
      { wizardId },
      "Wizard state missing on send intellivite action",
    );
    try {
      await client.views.update({
        view_id: body.view.id,
        view: buildSessionExpiredView(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show session expired view");
    }
    return;
  }

  const { mcNumber, channelId, carrierData } = state;
  const userId = body.user.id;

  // Get email from manual input or selected contact
  const manualEmail =
    body.view.state?.values?.manual_email_block?.manual_email_input?.value;
  const stateKey = `${wizardId}_selected_email`;
  const selectedEmail = wizardState.get(stateKey);
  const email = manualEmail || selectedEmail;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    try {
      await client.views.update({
        view_id: body.view.id,
        view: {
          ...body.view,
          blocks: [
            ...body.view.blocks.slice(0, -1),
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Please select a contact or enter a valid email address.*",
              },
            },
            body.view.blocks[body.view.blocks.length - 1],
          ],
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show email error");
    }
    return;
  }

  logger.info(
    { mcNumber, email: redactEmail(email), userId },
    "Sending Intellivite",
  );

  const result = await sendIntellivite(mcNumber, email);

  if (!result.success) {
    logger.error(
      { err: result.message, mcNumber, email: redactEmail(email) },
      "Failed to send Intellivite",
    );
    try {
      await client.views.update({
        view_id: body.view.id,
        view: {
          type: "modal",
          title: { type: "plain_text", text: "Error" },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "Failed to send Intellivite. Please try again or contact your administrator.",
              },
            },
          ],
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show error modal");
    }
    // Replacing the interactive view with a static error view bypasses the
    // Step 4 view_closed cleanup, so release the session here to avoid leaving
    // the channel guarded until the 5-minute expiry.
    wizardState.delete(stateKey);
    wizardState.delete(wizardId);
    clearActiveAssessment(channelId);
    return;
  }

  // Log to audit
  try {
    await logAuditEntry(userId, mcNumber, "invite");
  } catch (error) {
    logger.error({ err: error }, "Failed to log audit entry");
  }

  // Clean up wizard state
  wizardState.delete(stateKey);
  wizardState.delete(wizardId);

  // Clear active assessment for channel
  clearActiveAssessment(channelId);

  // Post success message to channel
  const carrierName = normalizeNullableText(
    carrierData?.CompanyName,
    "Unknown Carrier",
  );
  const safeEmail = normalizeNullableText(email, "unknown email");
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> invited ${carrierName} (MC${mcNumber}) via Intellivite\nContact: ${safeEmail}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to post success message");
  }

  // Show success modal
  try {
    await client.views.update({
      view_id: body.view.id,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "Success" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Intellivite sent to ${safeEmail} for ${carrierName} (MC${mcNumber}).\n\nConfirmation posted to channel.`,
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to show success modal");
  }
});

// Handle modal close (user clicked X, pressed Escape, or switched away)
slackApp.view("carrier_wizard", async ({ ack }) => {
  // This handles view_submission - just acknowledge
  await ack();
});

// Handle Step 4 modal submission (Send Intellivite)
slackApp.view("carrier_wizard_step4", async ({ ack, body, view, client }) => {
  let wizardId;
  try {
    ({ wizardId } = JSON.parse(view.private_metadata));
  } catch (parseError) {
    logger.warn(
      { err: parseError },
      "Failed to parse private_metadata in carrier_wizard_step4",
    );
    await ack({
      response_action: "errors",
      errors: {
        manual_email_block: "Session expired. Please start a new assessment.",
      },
    });
    return;
  }

  const state = wizardState.get(wizardId);
  const userId = body.user.id;

  if (!state) {
    await ack({
      response_action: "errors",
      errors: {
        manual_email_block: "Session expired. Please start a new assessment.",
      },
    });
    return;
  }

  const { mcNumber, channelId, carrierData } = state;

  // Get email from manual input or selected contact
  const manualEmail =
    view.state?.values?.manual_email_block?.manual_email_input?.value;
  const stateKey = `${wizardId}_selected_email`;
  const selectedEmail = wizardState.get(stateKey);
  const email = manualEmail || selectedEmail;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    await ack({
      response_action: "errors",
      errors: {
        manual_email_block:
          "Please select a contact or enter a valid email address.",
      },
    });
    return;
  }

  // Acknowledge immediately while we process
  await ack();

  logger.info(
    { mcNumber, email: redactEmail(email), userId },
    "Sending Intellivite via form submit",
  );

  const result = await sendIntellivite(mcNumber, email);

  if (!result.success) {
    logger.error(
      { err: result.message, mcNumber, email: redactEmail(email) },
      "Failed to send Intellivite",
    );
    try {
      await client.chat.postMessage({
        channel: channelId,
        text: `Failed to send Intellivite for MC${mcNumber}. Please try again or contact your administrator.`,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to post error message");
    }
    // The form was already acked, so the modal is closing without firing the
    // view_closed cleanup path — release the session here so the channel isn't
    // left guarded until the 5-minute expiry.
    wizardState.delete(stateKey);
    wizardState.delete(wizardId);
    clearActiveAssessment(channelId);
    return;
  }

  // Log to audit
  try {
    await logAuditEntry(userId, mcNumber, "invite");
  } catch (error) {
    logger.error({ err: error }, "Failed to log audit entry");
  }

  // Clean up wizard state
  wizardState.delete(stateKey);
  wizardState.delete(wizardId);

  // Clear active assessment for channel
  clearActiveAssessment(channelId);

  // Post success message to channel
  const carrierName = normalizeNullableText(
    carrierData?.CompanyName,
    "Unknown Carrier",
  );
  const safeEmail = normalizeNullableText(email, "unknown email");
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> invited ${carrierName} (MC${mcNumber}) via Intellivite\nContact: ${safeEmail}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to post success message");
  }
});

// Handle Step 4 modal close
slackApp.view(
  { callback_id: "carrier_wizard_step4", type: "view_closed" },
  async ({ ack, view }) => {
    await ack();

    try {
      const metadata = JSON.parse(view.private_metadata || "{}");
      const { wizardId } = metadata;

      if (wizardId) {
        const state = wizardState.get(wizardId);
        if (state) {
          const { channelId } = state;
          // Clean up
          clearActiveAssessment(channelId);
          wizardState.delete(wizardId);
          const stateKey = `${wizardId}_selected_email`;
          wizardState.delete(stateKey);
          logger.info({ wizardId }, "Step 4 wizard closed, cleaned up state");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error handling step 4 view close");
    }
  },
);

slackApp.view(
  { callback_id: "carrier_wizard", type: "view_closed" },
  async ({ ack, view }) => {
    await ack();

    try {
      const metadata = JSON.parse(view.private_metadata || "{}");
      const { wizardId } = metadata;

      if (wizardId) {
        const state = wizardState.get(wizardId);
        if (state) {
          const { channelId } = state;
          // Clean up
          clearActiveAssessment(channelId);
          wizardState.delete(`${wizardId}_selected_email`);
          wizardState.delete(wizardId);
          logger.info({ wizardId }, "Wizard closed, cleaned up state");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error handling view close");
    }
  },
);

slackApp.view(
  { callback_id: "carrier_wizard_loading", type: "view_closed" },
  async ({ ack, view }) => {
    await ack();

    try {
      const metadata = JSON.parse(view.private_metadata || "{}");
      const { mcNumber, channelId } = metadata;
      // The channel guard is set as soon as the loading modal opens, so a user
      // who cancels mid-fetch must release it — otherwise /risk stays blocked
      // for that channel until the 5-minute expiry.
      if (channelId) {
        clearActiveAssessment(channelId);
      }
      logger.info({ mcNumber, channelId }, "Loading modal closed by user");
    } catch (error) {
      logger.error({ err: error }, "Error handling loading view close");
    }
  },
);

// Start server with database initialization
async function startServer() {
  await loadTokens();
  await slackApp.start();
  logger.info(
    "Slack Bolt app is running in Socket Mode with health endpoint on port 3001",
  );
}

slackApp.error(async (error) => {
  logger.error({ err: error }, "Unhandled Slack Bolt error");
  Sentry.captureException(error, { tags: { source: "slack-bolt" } });
});

async function gracefulShutdown(signal) {
  logger.info({ signal }, "Received shutdown signal, closing gracefully");
  try {
    await slackApp.stop();
    await Sentry.close(2000);
  } catch (err) {
    logger.error({ err }, "Error during graceful shutdown");
  }
  process.exit(0);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

async function flushAndExit(reason, source) {
  Sentry.captureException(reason, { tags: { source } });
  try {
    await Sentry.close(2000);
  } catch (closeErr) {
    logger.error({ err: closeErr, source }, "Sentry.close failed during fatal handler");
  }
  process.exit(1);
}

function scheduleFatalExit(reason, source) {
  flushAndExit(reason, source).catch((handlerErr) => {
    logger.error({ err: handlerErr, source }, "Fatal handler itself threw");
    process.exit(1);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  scheduleFatalExit(reason, "unhandledRejection");
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  scheduleFatalExit(err, "uncaughtException");
});

// Only start the server when run directly (not imported for testing)
if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });
}

// Export functions for testing
if (typeof module !== "undefined") {
  module.exports = {
    getRiskLevelEmoji,
    getRiskLevel,
    isRiskPointsAvailable,
    formatRiskLevel,
    normalizeNullableText,
    normalizeMcInput,
    sanitizeHrefForSlack,
    formatSlackLinks,
    formatInfractionLine,
    chunkLines,
    hasActiveAssessment,
    setActiveAssessment,
    clearActiveAssessment,
    generateWizardId,
    buildSessionExpiredView,
    buildChannelAssessmentBlocks,
    buildStep1View,
    buildStep2View,
    buildStep3View,
    buildStep4View,
    // Export maps for test manipulation
    wizardState,
    activeAssessments,
    // Export for testing
    apiCall,
    fetchCarrierData,
    refreshAccessToken,
    flushAndExit,
    __getTokensForTest: () => ({
      bearer: BEARER_TOKEN,
      refresh: REFRESH_TOKEN,
    }),
    __setTokensForTest: (bearer, refresh) => {
      BEARER_TOKEN = bearer;
      REFRESH_TOKEN = refresh;
    },
  };
}
