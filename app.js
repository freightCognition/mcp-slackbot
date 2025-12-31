const { App } = require('@slack/bolt');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config();
const { initDb, getTokens, saveTokens } = require('./db');

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

// Verify required environment variables
const requiredEnvVars = [
  'BEARER_TOKEN', 'REFRESH_TOKEN', 'TOKEN_ENDPOINT_URL',
  'CLIENT_ID', 'CLIENT_SECRET', 'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET', 'SLACK_APP_TOKEN'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`${envVar} environment variable is required`);
    process.exit(1);
  }
}

// Initialize Bolt App
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
});

// Load tokens from database on startup
async function loadTokens() {
  try {
    await initDb();
    const dbTokens = await getTokens();
    if (dbTokens) {
      console.log('Loaded tokens from database');
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      // First run - save env tokens to database
      console.log('No tokens in database, saving from environment');
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
  } catch (error) {
    console.error('Error loading tokens from database:', error);
    console.log('Falling back to environment variables');
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
  console.log('Attempting to refresh access token...');
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

    console.log('Access token refreshed successfully.');
    BEARER_TOKEN = newAccessToken;

    let newRefreshIssued = false;
    if (newRefreshToken) {
      console.log('New refresh token received.');
      REFRESH_TOKEN = newRefreshToken;
      newRefreshIssued = true;
    } else {
      console.warn('New refresh token was not provided in the response. Old refresh token will be reused.');
    }

    // Save tokens to database
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);

    return { success: true, newRefreshIssued };
  } catch (error) {
    console.error('Error refreshing access token:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    if (error.response && error.response.status === 400) {
      console.error('Refresh token might be invalid or expired. Manual intervention may be required.');
    }
    return { success: false, newRefreshIssued: false };
  }
}


// Hanlde MCP command
app.command('/mcp', async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        private_metadata: body.channel_id,
        callback_id: 'mcp_modal_submission',
        title: {
          type: 'plain_text',
          text: 'MCP Risk Assessment'
        },
        blocks: [
          {
            type: 'input',
            block_id: 'mc_number_block',
            label: {
              type: 'plain_text',
              text: 'Enter MC Number'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'mc_number_input'
            }
          }
        ],
        submit: {
          type: 'plain_text',
          text: 'Submit'
        }
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});


// Hanlde MCP modal submission
app.view('mcp_modal_submission', async ({ ack, body, view, client }) => {
  await ack();

  const mcNumber = view.state.values.mc_number_block.mc_number_input.value.trim();
  const user = body.user.id;
  const channelId = view.private_metadata;
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      console.log(`Fetching data for MC number: ${mcNumber}, attempt ${attempt + 1}`);
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
        console.log(`No data found for MC number: ${mcNumber}`);
        await client.chat.postEphemeral({
          channel: channelId,
          user: user,
          text: `No data found for MC number: ${mcNumber}`
        });
        return;
      }

      const data = apiResponse.data[0];
      console.log(`Data received for MC number: ${mcNumber}`);

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

      await client.chat.postMessage({
        channel: channelId,
        text: `MCP Risk Assessment for MC #${mcNumber}`,
        blocks: blocks
      });

      return;
    } catch (error) {
      if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
        console.log('Access token expired or invalid. Attempting refresh...');
        const refreshed = await refreshAccessToken();
        if (refreshed.success) {
          console.log('Token refreshed. Retrying API call...');
          attempt++;
        } else {
          console.error('Failed to refresh token. Aborting.');
          await client.chat.postEphemeral({
            channel: channelId,
            user: user,
            text: "Error: Could not refresh authentication. Please check logs or contact admin."
          });
          return;
        }
      } else {
        console.error('API call failed or max retries reached:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        let userMessage = 'Error fetching data. Please try again later.';
        if (error.response && error.response.status === 401) {
            userMessage = 'Authentication failed even after attempting to refresh. Please contact an administrator.';
        }
        await client.chat.postEphemeral({
          channel: channelId,
          user: user,
          text: userMessage
        });
        return;
      }
    }
  }
});


// Start server with database initialization
(async () => {
  try {
    await loadTokens();
    await app.start();
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();
