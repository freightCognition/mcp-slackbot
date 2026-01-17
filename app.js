const { App } = require("@slack/bolt");
const axios = require("axios");
const qs = require("qs");
require("dotenv").config();
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

      if (method === "POST") {
        config.params = params;
      } else {
        config.params = params;
      }

      logger.info(
        { endpoint, params, attempt: attempt + 1 },
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
    TrucksTotal: profile?.Equipment?.trucksTotal || "N/A",
    DriversTotal: profile?.Drivers?.driversTotal || "N/A",
    PowerUnits: profile?.Equipment?.totalPower || "N/A",
    Phone: profile?.Identity?.businessPhone || "N/A",
    City: profile?.Identity?.businessCity || "N/A",
    State: profile?.Identity?.businessState || "N/A",
    AuthorityStatus: profile?.Authority?.commonAuthority || "N/A",
    AuthGrantDate: profile?.Authority?.authGrantDate || "N/A",
    IsBlocked: profile?.isBlocked || false,
    IsMonitored: profile?.isMonitored || false,
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

// Build Step 1: Assessment Overview modal
function buildStep1View(carrierData, mcNumber, channelId, wizardId = null) {
  const data = Array.isArray(carrierData) ? carrierData[0] : carrierData;
  const risk = data.RiskAssessmentDetails || {};

  // Generate wizard ID if not provided (first call) and store data in memory
  const wId = wizardId || generateWizardId();
  if (!wizardId) {
    wizardState.set(wId, { carrierData: data, mcNumber, channelId });
  }

  // Build company name with DBA if present
  const companyDisplay = data.DBAName
    ? `*${data.CompanyName}*\n_DBA: ${data.DBAName}_`
    : `*${data.CompanyName}*`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${companyDisplay}\nDOT: ${data.DotNumber} | MC: ${data.DocketNumber}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Trucks:*\n${data.TrucksTotal}`,
        },
        {
          type: "mrkdwn",
          text: `*Drivers:*\n${data.DriversTotal}`,
        },
        {
          type: "mrkdwn",
          text: `*Location:*\n${data.City}, ${data.State}`,
        },
        {
          type: "mrkdwn",
          text: `*Authority:*\n${data.AuthorityStatus}`,
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Overall Risk Assessment:* ${getRiskLevelEmoji(risk.TotalPoints)} ${getRiskLevel(risk.TotalPoints)} (${risk.TotalPoints || 0} pts)`,
      },
    },
    { type: "divider" },
  ];

  // Risk categories - compact summary (details available in Step 2)
  const categories = ["Authority", "Insurance", "Operation", "Safety", "Other"];
  const riskLines = categories
    .filter((category) => risk[category])
    .map((category) => {
      const categoryData = risk[category];
      const infractionCount = categoryData.Infractions?.length || 0;
      const countText = infractionCount > 0 ? ` (${infractionCount})` : "";
      return `*${category}:* ${getRiskLevelEmoji(categoryData.TotalPoints)} ${getRiskLevel(categoryData.TotalPoints)} (${categoryData.TotalPoints || 0} pts)${countText}`;
    })
    .join("\n");

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: riskLines || "No risk data available",
    },
  });

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
    private_metadata: JSON.stringify({ wizardId: wId, step: 1 }),
    title: { type: "plain_text", text: "Carrier Assessment", emoji: true },
    blocks,
  };
}

// Build Step 2: Detailed Risk Information modal
function buildStep2View(wizardId, incidentReports = []) {
  const state = wizardState.get(wizardId);
  const { carrierData } = state;
  const risk = carrierData.RiskAssessmentDetails || {};

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${carrierData.CompanyName || "Unknown Carrier"}* - Detailed Risk Information`,
      },
    },
    { type: "divider" },
  ];

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
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `- ${report.IncidentType || report.Type || "Incident"}: ${report.Description || report.Details || "No details"}`,
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
      const infractionText = categoryData.Infractions.map(
        (i) => `  - ${i.RuleText}: ${i.RuleOutput} (${i.Points} pts)`,
      ).join("\n");
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${category}:*\n${infractionText}`,
        },
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
    private_metadata: JSON.stringify({ wizardId, step: 2 }),
    title: { type: "plain_text", text: "Risk Details", emoji: true },
    blocks,
  };
}

// Build Step 3: Vehicle Information modal
function buildStep3View(wizardId, vinVerifications = []) {
  const state = wizardState.get(wizardId);
  const { carrierData } = state;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${carrierData.CompanyName || "Unknown Carrier"}* - Vehicle Information`,
      },
    },
    { type: "divider" },
  ];

  if (vinVerifications && vinVerifications.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Verified Vehicles:* ${vinVerifications.length} total`,
      },
    });

    vinVerifications.slice(0, 10).forEach((vin) => {
      const status = vin.VINVerificationStatus?.Description || "Unknown";
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `VIN: \`${vin.VIN || "N/A"}\` | Status: ${status}`,
          },
        ],
      });
    });

    if (vinVerifications.length > 10) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `...and ${vinVerifications.length - 10} more vehicles`,
          },
        ],
      });
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
    private_metadata: JSON.stringify({ wizardId, step: 3 }),
    title: { type: "plain_text", text: "Vehicles", emoji: true },
    blocks,
  };
}

// Build Step 4: Contacts & Intellivite modal
function buildStep4View(wizardId, contacts = []) {
  const state = wizardState.get(wizardId);
  const { carrierData } = state;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${carrierData.CompanyName || "Unknown Carrier"}* - Send Intellivite`,
      },
    },
    { type: "divider" },
  ];

  // Contact selection - API returns FirstName, LastName, Email
  const contactOptions = (contacts || [])
    .slice(0, 10)
    .filter((c) => c.Email)
    .map((contact) => {
      const name =
        contact.FirstName && contact.LastName
          ? `${contact.FirstName} ${contact.LastName}`
          : contact.Name || contact.ContactName || "Unknown";
      return {
        text: {
          type: "plain_text",
          text: `${name} - ${contact.Email}`,
        },
        value: contact.Email,
      };
    });

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

// Function to refresh the access token
async function refreshAccessToken() {
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

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;

    if (!newAccessToken) {
      throw new Error("New access token not found in refresh response");
    }

    logger.info("Access token refreshed successfully.");
    BEARER_TOKEN = newAccessToken;

    let newRefreshIssued = false;
    if (newRefreshToken) {
      logger.info("New refresh token received.");
      REFRESH_TOKEN = newRefreshToken;
      newRefreshIssued = true;
    } else {
      logger.warn(
        "New refresh token was not provided in the response. Old refresh token will be reused.",
      );
    }

    // Save tokens to database (non-blocking - in-memory tokens remain valid if DB fails)
    try {
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    } catch (dbError) {
      logger.error(
        {
          err: dbError,
          context: "refreshAccessToken",
          tokenRefreshSucceeded: true,
          newRefreshIssued,
        },
        "Failed to persist tokens to database - in-memory tokens remain valid",
      );
    }

    return { success: true, newRefreshIssued };
  } catch (error) {
    logger.error(
      {
        err: error,
        responseData: error.response ? error.response.data : undefined,
      },
      "Error refreshing access token",
    );
    if (error.response && error.response.status === 400) {
      logger.error(
        "Refresh token might be invalid or expired. Manual intervention may be required.",
      );
    }
    return { success: false, newRefreshIssued: false };
  }
}

// /mcp command - Opens carrier assessment wizard modal
slackApp.command("/mcp", async ({ command, ack, respond, client }) => {
  await ack();

  const { text, channel_id, trigger_id, user_id } = command;

  if (!text) {
    await respond({
      text: "Please provide a valid MC number.",
      response_type: "ephemeral",
    });
    return;
  }

  const mcNumber = text.trim();

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

  // Fetch carrier data using GetCarrierData endpoint
  const result = await fetchCarrierData(mcNumber);

  if (!result.success) {
    let errorMessage = "Error fetching carrier data. Please try again later.";
    if (result.error === "not_found") {
      errorMessage = `Carrier MC${mcNumber} not found in MCP database.`;
    } else if (result.error === "api_error") {
      errorMessage = `MCP API error: ${result.message}`;
    }
    await respond({ text: errorMessage, response_type: "ephemeral" });
    return;
  }

  const carrierData = result.data;
  if (
    !carrierData ||
    (Array.isArray(carrierData) && carrierData.length === 0)
  ) {
    await respond({
      text: "No data found for the provided MC number.",
      response_type: "ephemeral",
    });
    return;
  }

  // Build and open Step 1 modal
  const view = buildStep1View(carrierData, mcNumber, channel_id);

  try {
    await client.views.open({
      trigger_id,
      view,
    });
    // Mark assessment as active for this channel
    setActiveAssessment(channel_id, user_id, mcNumber);
    logger.info({ mcNumber, userId: user_id }, "Opened carrier wizard modal");
  } catch (error) {
    logger.error({ err: error, mcNumber }, "Failed to open modal");
    await respond({
      text: "Failed to open carrier assessment. Please try again.",
      response_type: "ephemeral",
    });
  }
});

// Handle wizard navigation - Next button
slackApp.action("wizard_next", async ({ ack, body, client }) => {
  await ack();

  const { wizardId, step } = JSON.parse(body.view.private_metadata);
  const state = wizardState.get(wizardId);
  const { mcNumber } = state;
  const userId = body.user.id;

  logger.info({ mcNumber, step, userId }, "Wizard next clicked");

  let newView;

  if (step === 1) {
    // Moving to Step 2 - fetch incident reports
    const incidentResult = await fetchCarrierIncidentReports(mcNumber);
    const incidentReports = incidentResult.success
      ? incidentResult.data?.IncidentReports || []
      : [];
    newView = buildStep2View(wizardId, incidentReports);
  } else if (step === 2) {
    // Moving to Step 3 - fetch VIN verifications
    const vinResult = await fetchCarrierVINVerifications(mcNumber);
    const vinVerifications = vinResult.success
      ? vinResult.data?.VINVerifications || []
      : [];
    newView = buildStep3View(wizardId, vinVerifications);
  } else if (step === 3) {
    // Moving to Step 4 - fetch contacts
    const contactsResult = await fetchCarrierContacts(mcNumber);
    const contacts = contactsResult.success
      ? contactsResult.data?.Carrier?.Contacts || []
      : [];
    newView = buildStep4View(wizardId, contacts);
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

  const { wizardId, step } = JSON.parse(body.view.private_metadata);
  const state = wizardState.get(wizardId);
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

// Handle wizard decline
slackApp.action("wizard_decline", async ({ ack, body, client }) => {
  await ack();

  const { wizardId } = JSON.parse(body.view.private_metadata);
  const state = wizardState.get(wizardId);
  const { mcNumber, channelId, carrierData } = state;
  const userId = body.user.id;

  logger.info({ mcNumber, userId }, "Carrier declined");

  // Clear active assessment and wizard state
  clearActiveAssessment(channelId);
  wizardState.delete(wizardId);

  // Log to audit
  try {
    await logAuditEntry(userId, mcNumber, "decline");
  } catch (error) {
    logger.error({ err: error }, "Failed to log audit entry");
  }

  // Post decline message to channel
  try {
    const carrierName = carrierData?.CompanyName || "Unknown Carrier";
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
  // Store selected contact in wizard state
  const selectedEmail = body.actions[0].selected_option?.value;
  if (selectedEmail) {
    const stateKey = `${body.user.id}_selected_email`;
    wizardState.set(stateKey, selectedEmail);
    logger.info({ userId: body.user.id, selectedEmail }, "Contact selected");
  }
});

// Handle Send Intellivite
slackApp.action("wizard_send_intellivite", async ({ ack, body, client }) => {
  await ack();

  const { wizardId } = JSON.parse(body.view.private_metadata);
  const state = wizardState.get(wizardId);
  const { mcNumber, channelId, carrierData } = state;
  const userId = body.user.id;

  // Get email from manual input or selected contact
  const manualEmail =
    body.view.state?.values?.manual_email_block?.manual_email_input?.value;
  const stateKey = `${userId}_selected_email`;
  const selectedEmail = wizardState.get(stateKey);
  const email = manualEmail || selectedEmail;

  if (!email) {
    // Update modal with error
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
                text: "*Please select a contact or enter an email address.*",
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

  logger.info({ mcNumber, email, userId }, "Sending Intellivite");

  // Send Intellivite invitation
  const result = await sendIntellivite(mcNumber, email);

  if (!result.success) {
    logger.error(
      { err: result.message, mcNumber, email },
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
                text: `Failed to send Intellivite: ${result.message}`,
              },
            },
          ],
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to show error modal");
    }
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
  const carrierName = carrierData?.CompanyName || "Unknown Carrier";
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> invited ${carrierName} (MC${mcNumber}) via Intellivite\nContact: ${email}`,
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
              text: `Intellivite sent to ${email} for ${carrierName} (MC${mcNumber}).\n\nConfirmation posted to channel.`,
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
slackApp.view("carrier_wizard", async ({ ack, body, view }) => {
  // This handles view_submission - just acknowledge
  await ack();
});

// Handle Step 4 modal submission (Send Intellivite)
slackApp.view("carrier_wizard_step4", async ({ ack, body, view, client }) => {
  const { wizardId } = JSON.parse(view.private_metadata);
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
  const stateKey = `${userId}_selected_email`;
  const selectedEmail = wizardState.get(stateKey);
  const email = manualEmail || selectedEmail;

  if (!email) {
    await ack({
      response_action: "errors",
      errors: {
        manual_email_block:
          "Please select a contact or enter an email address.",
      },
    });
    return;
  }

  // Acknowledge immediately while we process
  await ack();

  logger.info(
    { mcNumber, email, userId },
    "Sending Intellivite via form submit",
  );

  // Send Intellivite invitation
  const result = await sendIntellivite(mcNumber, email);

  if (!result.success) {
    logger.error(
      { err: result.message, mcNumber, email },
      "Failed to send Intellivite",
    );
    // Post error to channel since modal is already closed
    try {
      await client.chat.postMessage({
        channel: channelId,
        text: `Failed to send Intellivite for MC${mcNumber}: ${result.message}`,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to post error message");
    }
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
  const carrierName = carrierData?.CompanyName || "Unknown Carrier";
  try {
    await client.chat.postMessage({
      channel: channelId,
      text: `<@${userId}> invited ${carrierName} (MC${mcNumber}) via Intellivite\nContact: ${email}`,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to post success message");
  }
});

// Handle Step 4 modal close
slackApp.view(
  { callback_id: "carrier_wizard_step4", type: "view_closed" },
  async ({ ack, body, view }) => {
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
          const stateKey = `${body.user.id}_selected_email`;
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
  async ({ ack, body, view }) => {
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
          logger.info({ wizardId }, "Wizard closed, cleaned up state");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error handling view close");
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

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  process.exit(1);
});

startServer().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
