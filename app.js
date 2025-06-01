const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const rawBody = require('raw-body');
const timingSafeCompare = require('tsscmp');
const fs = require('fs');
const path = require('path');
const qs = require('qs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Verify required environment variables
if (!BEARER_TOKEN) {
  console.error('BEARER_TOKEN environment variable is required');
  process.exit(1);
}
if (!REFRESH_TOKEN) {
  console.error('REFRESH_TOKEN environment variable is required');
  process.exit(1);
}
if (!TOKEN_ENDPOINT_URL) {
  console.error('TOKEN_ENDPOINT_URL environment variable is required');
  process.exit(1);
}

if (!SLACK_SIGNING_SECRET) {
  console.error('SLACK_SIGNING_SECRET environment variable is required');
  process.exit(1);
}

if (!SLACK_WEBHOOK_URL) {
  console.error('SLACK_WEBHOOK_URL environment variable is required');
  process.exit(1);
}

// Raw body parsing for Slack signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true,
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

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

// Middleware to verify Slack requests
const verifySlackRequest = (req, res, next) => {
  const signature = req.headers['x-slack-signature'];
  const timestamp = req.headers['x-slack-request-timestamp'];

  if (!signature || !timestamp) {
    console.error('Missing required Slack headers');
    return res.status(400).send('Missing required headers');
  }

  // Check for replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (timestamp < fiveMinutesAgo) {
    console.error('Request is too old');
    return res.status(400).send('Request is too old');
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = 'v0=' + 
    crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(sigBasestring, 'utf8')
      .digest('hex');

  if (!timingSafeCompare(mySignature, signature)) {
    console.error('Invalid signature');
    return res.status(401).send('Invalid signature');
  }

  next();
};

// Helper function to update .env file
const envFilePath = path.resolve(__dirname, '.env');
function updateEnvFile(updatedValues) {
  try {
    let envContent = fs.readFileSync(envFilePath, 'utf8');
    Object.entries(updatedValues).forEach(([key, value]) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    });
    fs.writeFileSync(envFilePath, envContent);
    console.log('.env file updated successfully.');
  } catch (err) {
    console.error('Error writing to .env file:', err);
  }
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
    process.env.BEARER_TOKEN = newAccessToken;
    updateEnvFile({ BEARER_TOKEN: newAccessToken });

    if (newRefreshToken) {
      console.log('New refresh token received.');
      REFRESH_TOKEN = newRefreshToken;
      process.env.REFRESH_TOKEN = newRefreshToken;
      updateEnvFile({ REFRESH_TOKEN: newRefreshToken });
    } else {
      console.warn('New refresh token was not provided in the response. Old refresh token will be reused.');
    }

    return true;
  } catch (error) {
    console.error('Error refreshing access token:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    if (error.response && error.response.status === 400) {
      console.error('Refresh token might be invalid or expired. Manual intervention may be required.');
    }
    return false;
  }
}

app.post('/slack/commands', verifySlackRequest, async (req, res) => {
  const { text, response_url } = req.body;

  if (!text) {
    return res.send('Please provide a valid MC number.');
  }

  const mcNumber = text.trim();
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
        return res.send('No data found for the provided MC number.');
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

      const slackResponse = {
        response_type: 'in_channel',
        blocks: blocks
      };

      console.log(`Sending Slack response for MC number: ${mcNumber}`);
      
      // Send immediate acknowledgment
      res.send();

      // Send detailed response via webhook
      try {
        await axios.post(SLACK_WEBHOOK_URL, slackResponse, { 
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000 
        });
      } catch (webhookError) {
        console.error('Error sending webhook response:', webhookError);
        // Try fallback to response_url if webhook fails
        if (response_url) {
          try {
            await axios.post(response_url, slackResponse, { timeout: 5000 });
          } catch (fallbackError) {
            console.error('Error sending fallback response:', fallbackError);
          }
        }
      }

      return;
    } catch (error) {
      if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
        console.log('Access token expired or invalid. Attempting refresh...');
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          console.log('Token refreshed. Retrying API call...');
          attempt++;
        } else {
          console.error('Failed to refresh token. Aborting.');
          return res.send("Error: Could not refresh authentication. Please check logs or contact admin.");
        }
      } else {
        console.error('API call failed or max retries reached:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        let userMessage = 'Error fetching data. Please try again later.';
        if (error.response && error.response.status === 401) {
            userMessage = 'Authentication failed even after attempting to refresh. Please contact an administrator.';
        }
        return res.send(userMessage);
      }
    }
  } // end while loop
});

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});