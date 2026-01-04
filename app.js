const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const rawBody = require('raw-body');
const timingSafeCompare = require('tsscmp');
const qs = require('qs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { initDb, getTokens, saveTokens } = require('./db');
const logger = require('./logger');
const AppError = require('./errors/AppError');

const app = express();
const port = process.env.PORT || 3001;

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Verify required environment variables
const requiredEnvVars = [
  'BEARER_TOKEN',
  'REFRESH_TOKEN',
  'TOKEN_ENDPOINT_URL',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'SLACK_WEBHOOK_URL'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables', { missing: missingEnvVars });
  process.exit(1);
}

// Global Uncaught Exception Handler
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', { error: err });
  process.exit(1);
});

// Global Unhandled Rejection Handler
process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! 💥 Shutting down...', { error: err });
  process.exit(1);
});

// Request Logger Middleware
app.use((req, res, next) => {
  req.id = uuidv4();
  logger.info(`Incoming request: ${req.method} ${req.originalUrl}`, {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });
  next();
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
    logger.error('Error loading tokens from database', { error });
    logger.info('Falling back to environment variables');
  }
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
    logger.warn('Missing required Slack headers', { requestId: req.id });
    return res.status(400).send('Missing required headers');
  }

  // Check for replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (timestamp < fiveMinutesAgo) {
    logger.warn('Request is too old', { requestId: req.id, timestamp });
    return res.status(400).send('Request is too old');
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = 'v0=' +
    crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(sigBasestring, 'utf8')
      .digest('hex');

  if (!timingSafeCompare(mySignature, signature)) {
    logger.warn('Invalid signature', { requestId: req.id });
    return res.status(401).send('Invalid signature');
  }

  next();
};

// Middleware to verify test endpoint requests
const verifyTestEndpointAuth = (req, res, next) => {
  // Require an API key for test endpoints
  const authHeader = req.headers['authorization'];
  const apiKey = req.headers['x-api-key'];

  // Check for either Bearer token or X-API-Key header
  if (!authHeader && !apiKey) {
    logger.warn('Missing authentication for test endpoint', { requestId: req.id });
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Missing authentication'
    });
  }

  // Verify against a test API key from environment
  const validApiKey = process.env.TEST_API_KEY;

  if (!validApiKey) {
    logger.error('TEST_API_KEY not configured', { requestId: req.id });
    return res.status(503).json({
      status: 'error',
      message: 'Service unavailable: Authentication not configured'
    });
  }

  // Check X-API-Key header
  if (apiKey && timingSafeCompare(apiKey, validApiKey)) {
    return next();
  }

  // Check Authorization: Bearer header
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    if (timingSafeCompare(token, validApiKey)) {
      return next();
    }
  }

  logger.warn('Invalid authentication credentials for test endpoint', { requestId: req.id });
  return res.status(401).json({
    status: 'error',
    message: 'Unauthorized: Invalid credentials'
  });
};

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

    // Save tokens to database
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);

    return { success: true, newRefreshIssued };
  } catch (error) {
    logger.error('Error refreshing access token', {
      error: error.response ? JSON.stringify(error.response.data) : error.message,
      requestId: null // No request ID context here
    });
    if (error.response && error.response.status === 400) {
      logger.error('Refresh token might be invalid or expired. Manual intervention may be required.');
    }
    return { success: false, newRefreshIssued: false };
  }
}

app.post('/slack/commands', verifySlackRequest, async (req, res, next) => {
  try {
    const { text, response_url } = req.body;

    if (!text) {
      logger.info('Received Slack command with no text', { requestId: req.id });
      return res.send('Please provide a valid MC number.');
    }

    const mcNumber = text.trim();
    let attempt = 0;
    const maxAttempts = 2;

    while (attempt < maxAttempts) {
      try {
        logger.info(`Fetching data for MC number: ${mcNumber}, attempt ${attempt + 1}`, { requestId: req.id, mcNumber, attempt: attempt + 1 });
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
          logger.info(`No data found for MC number: ${mcNumber}`, { requestId: req.id });
          return res.send('No data found for the provided MC number.');
        }

        const data = apiResponse.data[0];
        logger.info(`Data received for MC number: ${mcNumber}`, { requestId: req.id });

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

        logger.info(`Sending Slack response for MC number: ${mcNumber}`, { requestId: req.id });

        // Send immediate acknowledgment
        res.send();

        // Send detailed response via webhook
        try {
          await axios.post(SLACK_WEBHOOK_URL, slackResponse, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          });
        } catch (webhookError) {
          logger.error('Error sending webhook response', { requestId: req.id, error: webhookError });
          // Try fallback to response_url if webhook fails
          if (response_url) {
            try {
              await axios.post(response_url, slackResponse, { timeout: 5000 });
            } catch (fallbackError) {
              logger.error('Error sending fallback response', { requestId: req.id, error: fallbackError });
            }
          }
        }

        return;
      } catch (error) {
        if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
          logger.info('Access token expired or invalid. Attempting refresh...', { requestId: req.id });
          const refreshed = await refreshAccessToken();
          if (refreshed.success) {
            logger.info('Token refreshed. Retrying API call...', { requestId: req.id });
            attempt++;
          } else {
            logger.error('Failed to refresh token. Aborting.', { requestId: req.id });
            return res.send("Error: Could not refresh authentication. Please check logs or contact admin.");
          }
        } else {
          logger.error('API call failed or max retries reached', { requestId: req.id, error: error.response ? JSON.stringify(error.response.data) : error.message });
          let userMessage = 'Error fetching data. Please try again later.';
          if (error.response && error.response.status === 401) {
              userMessage = 'Authentication failed even after attempting to refresh. Please contact an administrator.';
          }
          return res.send(userMessage);
        }
      }
    } // end while loop
  } catch (err) {
    next(err);
  }
});

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Test endpoint for refresh token verification (for testing/debugging)
app.get('/test/refresh', verifyTestEndpointAuth, async (req, res, next) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ status: 'error', message: 'Not found' });
  }

  try {
    logger.info('Refresh token test endpoint called', { requestId: req.id });
    const result = await refreshAccessToken();
    if (result.success) {
      res.json({
        status: 'success',
        message: 'Token refreshed successfully',
        timestamp: new Date().toISOString(),
        hasNewRefreshToken: result.newRefreshIssued
      });
    } else {
      res.status(500).json({
        status: 'error',
        message: 'Failed to refresh token. Check server logs for details.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    logger.error('Error in refresh test endpoint', { requestId: req.id, error: error.message });
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  logger.error('Unhandled error occurred', {
    requestId: req.id,
    message: err.message,
    stack: err.stack,
    statusCode: err.statusCode
  });

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message
  });
});

// Start server with database initialization
async function startServer() {
  await loadTokens();
  app.listen(port, () => {
    logger.info(`Server is running on port ${port}`);
  });
}

startServer().catch(err => {
  logger.error('Failed to start server', { error: err });
  process.exit(1);
});
