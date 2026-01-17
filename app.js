const { App } = require('@slack/bolt');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config();
const { initDb, getTokens, saveTokens } = require('./db');
const logger = require('./logger');

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

// API endpoint
const CARRIER_API_URL = 'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier';

// Verify required environment variables
const requiredEnvVars = [
  'BEARER_TOKEN',
  'REFRESH_TOKEN',
  'TOKEN_ENDPOINT_URL',
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN'
];

const missingEnvVars = requiredEnvVars.filter(name => !process.env[name]);
if (missingEnvVars.length > 0) {
  logger.error({ missing: missingEnvVars }, `Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// Track database availability for health checks and error surfacing
let databaseAvailable = false;

// Initialize Bolt App with health check endpoint
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
  customRoutes: [
    {
      path: '/health',
      method: ['GET'],
      handler: (req, res) => {
        const status = {
          status: 'healthy',
          databaseAvailable,
          timestamp: new Date().toISOString()
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      }
    }
  ],
  installerOptions: {
    port: 3001
  }
});

// Global error handler for Bolt
app.error(async (error) => {
  logger.error({
    err: error,
    code: error.code,
    original: error.original
  }, 'Unhandled error in Bolt application');
});

// Load tokens from database on startup
async function loadTokens() {
  try {
    await initDb();
    databaseAvailable = true;
    const dbTokens = await getTokens();
    if (dbTokens) {
      logger.info('Loaded tokens from database');
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      // First run - save env tokens to database
      logger.info('No tokens in database, saving from environment');
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
  } catch (error) {
    databaseAvailable = false;
    logger.error({
      err: error,
      consequence: 'Token persistence DISABLED - refreshed tokens will be lost on restart'
    }, 'CRITICAL: Database initialization failed');
    logger.warn('Falling back to environment variables - token persistence is disabled');
  }
}

// Risk level thresholds and mappings
const RISK_THRESHOLDS = [
  { max: 124, emoji: '🟢', level: 'Low' },
  { max: 249, emoji: '🟡', level: 'Medium' },
  { max: 999, emoji: '🟠', level: 'Review Required' }
];
const DEFAULT_RISK = { emoji: '🔴', level: 'Fail' };

function getRiskInfo(points) {
  return RISK_THRESHOLDS.find(t => points >= 0 && points <= t.max) || DEFAULT_RISK;
}

function getRiskLevelEmoji(points) {
  return getRiskInfo(points).emoji;
}

function getRiskLevel(points) {
  return getRiskInfo(points).level;
}

// Helper function to format infraction details
function formatInfractions(infractions) {
  if (!infractions || infractions.length === 0) {
    return "No infractions found.";
  }
  return infractions.map(infraction => {
    return `- ${infraction.RuleText}: ${infraction.RuleOutput} (${infraction.Points} points)`;
  }).join('\n');
}

// Safe wrapper for Slack respond() to catch and log errors
async function safeRespond(respond, message, context = {}) {
  try {
    await respond(message);
  } catch (error) {
    logger.error({
      err: error,
      intendedMessage: typeof message === 'string' ? message : message.text || 'blocks response',
      ...context
    }, 'Failed to send Slack response');
  }
}

// Mutex for token refresh to prevent concurrent refresh attempts
let tokenRefreshInProgress = null;

// Function to refresh the access token (with mutex)
async function refreshAccessToken() {
  // If a refresh is already in progress, wait for it
  if (tokenRefreshInProgress) {
    logger.info('Token refresh already in progress, waiting for completion');
    return tokenRefreshInProgress;
  }

  // Start new refresh and store the promise
  tokenRefreshInProgress = doRefreshAccessToken();
  try {
    return await tokenRefreshInProgress;
  } finally {
    tokenRefreshInProgress = null;
  }
}

// Internal function that performs the actual token refresh
async function doRefreshAccessToken() {
  logger.info('Attempting to refresh access token...');
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

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;

    if (!newAccessToken) {
      throw new Error('New access token not found in refresh response');
    }

    logger.info('Access token refreshed successfully.');
    BEARER_TOKEN = newAccessToken;

    let newRefreshIssued = false;
    if (newRefreshToken) {
      logger.info('New refresh token received.');
      REFRESH_TOKEN = newRefreshToken;
      newRefreshIssued = true;
    } else {
      logger.warn('New refresh token was not provided in the response. Old refresh token will be reused.');
    }

    // Save tokens to database
    let persistenceSucceeded = false;
    if (databaseAvailable) {
      try {
        await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
        persistenceSucceeded = true;
      } catch (dbError) {
        logger.error({
          err: dbError,
          context: 'refreshAccessToken',
          tokenRefreshSucceeded: true,
          newRefreshIssued,
          consequence: 'Tokens will be lost on application restart'
        }, 'CRITICAL: Failed to persist tokens to database');
      }
    } else {
      logger.warn({
        context: 'refreshAccessToken',
        tokenRefreshSucceeded: true,
        consequence: 'Tokens will be lost on application restart'
      }, 'Token persistence skipped - database unavailable since startup');
    }

    return { success: true, newRefreshIssued, persistenceSucceeded };
  } catch (error) {
    logger.error({
      err: error,
      responseData: error.response ? error.response.data : undefined
    }, 'Error refreshing access token');
    if (error.response && error.response.status === 400) {
      logger.error('Refresh token might be invalid or expired. Manual intervention may be required.');
    }
    return { success: false, newRefreshIssued: false };
  }
}

app.command('/mcp', async ({ command, ack, respond }) => {
  await ack();

  const { text } = command;

  if (!text) {
    await safeRespond(respond, {
      text: 'Please provide a valid MC number.',
      response_type: 'ephemeral'
    });
    return;
  }

  const mcNumber = text.trim();
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      logger.info({ mcNumber, attempt: attempt + 1 }, 'Fetching data for MC number');
      const apiResponse = await axios.post(
        CARRIER_API_URL,
        null,
        {
          params: { docketNumber: mcNumber },
          headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (!apiResponse.data || apiResponse.data.length === 0) {
        logger.info({ mcNumber }, 'No data found for MC number');
        await safeRespond(respond, {
            text: 'No data found for the provided MC number.',
            response_type: 'ephemeral'
        }, { mcNumber });
        return;
      }

      const data = apiResponse.data[0];
      logger.info({ mcNumber }, 'Data received for MC number');

      const blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "MyCarrierPortal Risk Assessment",
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${data.CompanyName || 'N/A'}*\nDOT: ${data.DotNumber || 'N/A'} / MC: ${data.DocketNumber || 'N/A'}`
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Overall assessment:* ${getRiskLevelEmoji(data.RiskAssessmentDetails?.TotalPoints)} ${getRiskLevel(data.RiskAssessmentDetails?.TotalPoints)}`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Total Points: ${data.RiskAssessmentDetails?.TotalPoints || 'N/A'}`
            }
          ]
        },
        {
          type: "divider"
        }
      ];

      const categories = ['Authority', 'Insurance', 'Operation', 'Safety', 'Other'];
      categories.forEach(category => {
        const categoryData = data.RiskAssessmentDetails?.[category];
        if (categoryData) {
          blocks.push(
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${category}:* ${getRiskLevelEmoji(categoryData.TotalPoints)} ${getRiskLevel(categoryData.TotalPoints)}`
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Risk Level: ${getRiskLevel(categoryData.TotalPoints)} | Points: ${categoryData.TotalPoints}\nInfractions:\n${formatInfractions(categoryData.Infractions)}`
                }
              ]
            }
          );
        }
      });

      // Add MyCarrierProtect section
      const mcpPoints = (data.IsBlocked ? 1000 : 0) + (data.FreightValidateStatus === 'Review Recommended' ? 1000 : 0);
      const mcpData = {
        TotalPoints: mcpPoints,
        OverallRating: getRiskLevel(mcpPoints),
        Infractions: []
      };
      if (data.IsBlocked) {
        mcpData.Infractions.push({
          Points: 1000,
          RiskLevel: 'Review Required',
          RuleText: 'MyCarrierProtect: Blocked',
          RuleOutput: 'Carrier blocked by 3 or more companies'
        });
      }
      if (data.FreightValidateStatus === 'Review Recommended') {
        mcpData.Infractions.push({
          Points: 1000,
          RiskLevel: 'Review Required',
          RuleText: 'FreightValidate Status',
          RuleOutput: 'Carrier has a FreightValidate Review Recommended status'
        });
      }

      if (mcpData.TotalPoints > 0) {
        let mcpDetailsText = `Risk Level: ${mcpData.OverallRating} | Points: ${mcpData.TotalPoints}`;
        mcpDetailsText += `\nInfractions:\n${formatInfractions(mcpData.Infractions)}`;
        blocks.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*MyCarrierProtect:* ${getRiskLevelEmoji(mcpData.TotalPoints)} ${mcpData.OverallRating}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: mcpDetailsText
              }
            ]
          },
          {
            type: "divider"
          }
        );
      }

      logger.info({ mcNumber }, 'Sending Slack response for MC number');

      await safeRespond(respond, {
        blocks,
        response_type: 'in_channel'
      }, { mcNumber });

      return;
    } catch (error) {
      if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
        logger.warn({ mcNumber, err: error }, 'Access token expired or invalid. Attempting refresh');
        const refreshed = await refreshAccessToken();
        if (refreshed.success) {
          logger.info({ mcNumber }, 'Token refreshed. Retrying API call');
          attempt++;
        } else {
          logger.error({ mcNumber }, 'Failed to refresh token. Aborting.');
          await safeRespond(respond, {
            text: "Error: Could not refresh authentication. Please check logs or contact admin.",
            response_type: 'ephemeral'
          }, { mcNumber });
          return;
        }
      } else {
        logger.error({
          err: error,
          responseData: error.response ? error.response.data : undefined,
          mcNumber
        }, 'API call failed or max retries reached');
        let userMessage = 'Error fetching data. Please try again later.';
        if (error.response && error.response.status === 401) {
            userMessage = 'Authentication failed even after attempting to refresh. Please contact an administrator.';
        }
        await safeRespond(respond, {
            text: userMessage,
            response_type: 'ephemeral'
        }, { mcNumber });
        return;
      }
    }
  } // end while loop
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

// Graceful shutdown handlers
async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal, closing gracefully');
  try {
    await app.stop();
    logger.info('Bolt app stopped successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start app with database initialization
(async () => {
  try {
    await loadTokens();
    await app.start();
    logger.info('⚡️ Bolt app is running!');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start app');
    process.exit(1);
  }
})();
