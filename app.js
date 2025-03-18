const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const rawBody = require('raw-body');
const timingSafeCompare = require('tsscmp');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Environment variables
const BEARER_TOKEN = process.env.BEARER_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Verify required environment variables
if (!BEARER_TOKEN) {
  console.error('BEARER_TOKEN environment variable is required');
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

app.post('/slack/commands', verifySlackRequest, async (req, res) => {
  const { text, response_url } = req.body;

  if (!text) {
    return res.send('Please provide a valid MC number.');
  }

  const mcNumber = text.trim();

  try {
    console.log(`Fetching data for MC number: ${mcNumber}`);
    const response = await axios.post(
      'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier',
      null,
      {
        params: { docketNumber: mcNumber },
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 seconds timeout
      }
    );

    if (!response.data || response.data.length === 0) {
      console.log(`No data found for MC number: ${mcNumber}`);
      return res.send('No data found for the provided MC number.');
    }

    const data = response.data[0];
    console.log(`Data received for MC number: ${mcNumber}`, JSON.stringify(data, null, 2));

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

    // Add sections for each risk assessment category with enhanced details
    const categories = ['Authority', 'Insurance', 'Operation', 'Safety', 'Other'];
    categories.forEach(category => {
      const categoryData = data.RiskAssessmentDetails?.[category];
      if (categoryData) {
        let detailsText = `Risk Level: ${getRiskLevel(categoryData.TotalPoints)} | Points: ${categoryData.TotalPoints}`;

        // Add formatted infractions
        detailsText += `\nInfractions:\n${formatInfractions(categoryData.Infractions)}`;

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
                text: detailsText
              }
            ]
          },
          {
            type: "divider"
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
  } catch (error) {
    console.error('Error fetching carrier data:', error);
    let errorMessage = 'Failed to retrieve carrier data. Please try again.';
    if (error.response) {
      console.error('API response error:', error.response.status, error.response.data);
      errorMessage = `API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      console.error('No response received:', error.request);
      errorMessage = 'No response received from the API. Please try again later.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'The request timed out. Please try again later.';
    }
    res.status(500).send(errorMessage);
  }
});

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
