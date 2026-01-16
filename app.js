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
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

// Verify required environment variables
if (!BEARER_TOKEN) {
  logger.error('BEARER_TOKEN environment variable is required');
  process.exit(1);
}
if (!REFRESH_TOKEN) {
  logger.error('REFRESH_TOKEN environment variable is required');
  process.exit(1);
}
if (!TOKEN_ENDPOINT_URL) {
  logger.error('TOKEN_ENDPOINT_URL environment variable is required');
  process.exit(1);
}
if (!CLIENT_ID) {
  logger.error('CLIENT_ID environment variable is required');
  process.exit(1);
}
if (!CLIENT_SECRET) {
  logger.error('CLIENT_SECRET environment variable is required');
  process.exit(1);
}
if (!SLACK_SIGNING_SECRET) {
  logger.error('SLACK_SIGNING_SECRET environment variable is required');
  process.exit(1);
}
if (!SLACK_BOT_TOKEN) {
  logger.error('SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}
if (!SLACK_APP_TOKEN) {
  logger.error('SLACK_APP_TOKEN environment variable is required');
  process.exit(1);
}

const slackApp = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true
});

// Load tokens from database on startup
async function loadTokens() {
  try {
    await initDb();
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
    logger.error({ err: error }, 'Error loading tokens from database');
    logger.warn('Falling back to environment variables');
  }
}

function getRiskLevelEmoji(points) {
  if (points >= 0 && points <= 124) {
    return '🟢';
  } else if (points >= 125 && points <= 249) {
    return '🟡';
  } else if (points >= 250 && points <= 999) {
    return '🟠';
  } else {
    return '🔴';
  }
}

function getRiskLevel(points) {
  if (points >= 0 && points <= 124) {
    return 'Low';
  } else if (points >= 125 && points <= 249) {
    return 'Medium';
  } else if (points >= 250 && points <= 999) {
    return 'Review Required';
  } else {
    return 'Fail';
  }
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

// Function to refresh the access token
async function refreshAccessToken() {
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

    return { success: true, newRefreshIssued };
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

slackApp.command('/mcp', async ({ command, ack, respond }) => {
  await ack();

  const { text } = command;

  if (!text) {
    await respond({
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
        'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier',
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
        await respond({
          text: 'No data found for the provided MC number.',
          response_type: 'ephemeral'
        });
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
      const mcpData = {
        TotalPoints: (data.IsBlocked ? 1000 : 0) + (data.FreightValidateStatus === 'Review Recommended' ? 1000 : 0),
        OverallRating: getRiskLevel((data.IsBlocked ? 1000 : 0) + (data.FreightValidateStatus === 'Review Recommended' ? 1000 : 0)),
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

      const slackResponse = {
        response_type: 'in_channel',
        blocks: blocks
      };

      logger.info({ mcNumber }, 'Sending Slack response for MC number');

      await respond(slackResponse);

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
          await respond({
            text: 'Error: Could not refresh authentication. Please check logs or contact admin.',
            response_type: 'ephemeral'
          });
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
        await respond({
          text: userMessage,
          response_type: 'ephemeral'
        });
        return;
      }
    }
  }
});

// Start server with database initialization
async function startServer() {
  await loadTokens();
  await slackApp.start();
  logger.info('Slack Bolt app is running in Socket Mode');
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

startServer().catch(err => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
