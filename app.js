const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const timingSafeCompare = require('tsscmp');
const qs = require('qs');
const pino = require('pino');
const pinoHttp = require('pino-http');
require('dotenv').config();
const { initDb, getTokens, saveTokens } = require('./db');
const logger = require('./logger');

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

if (!SLACK_WEBHOOK_URL) {
  logger.error('SLACK_WEBHOOK_URL environment variable is required');
  process.exit(1);
}

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

const requestLogger = pinoHttp({
  logger,
  customLogLevel: (res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.originalUrl
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode
      };
    },
    err: pino.stdSerializers.err
  },
  autoLogging: {
    ignore: (req) => req.originalUrl === '/health'
  }
});

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

app.use(requestLogger);

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
    logger.warn({
      requestId: req.id,
      method: req.method,
      url: req.originalUrl
    }, 'Missing required Slack headers');
    return res.status(400).send('Missing required headers');
  }

  // Check for replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (timestamp < fiveMinutesAgo) {
    logger.warn({
      requestId: req.id,
      method: req.method,
      url: req.originalUrl
    }, 'Request is too old');
    return res.status(400).send('Request is too old');
  }

  const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
  const mySignature = 'v0=' + 
    crypto.createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(sigBasestring, 'utf8')
      .digest('hex');

  if (!timingSafeCompare(mySignature, signature)) {
    logger.warn({
      requestId: req.id,
      method: req.method,
      url: req.originalUrl
    }, 'Invalid signature');
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
    logger.warn({
      requestId: req.id,
      method: req.method,
      url: req.originalUrl
    }, 'Missing authentication for test endpoint');
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Missing authentication'
    });
  }

  // Verify against a test API key from environment
  const validApiKey = process.env.TEST_API_KEY;

  if (!validApiKey) {
    logger.error('TEST_API_KEY not configured');
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

  logger.warn({
    requestId: req.id,
    method: req.method,
    url: req.originalUrl
  }, 'Invalid authentication credentials for test endpoint');
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

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.post('/slack/commands', verifySlackRequest, asyncHandler(async (req, res) => {
  const { text, response_url } = req.body;

  if (!text) {
    return res.send('Please provide a valid MC number.');
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
        return res.send('No data found for the provided MC number.');
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
      
      // Send immediate acknowledgment
      res.send();

      // Send detailed response via webhook
      try {
        await axios.post(SLACK_WEBHOOK_URL, slackResponse, { 
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000 
        });
      } catch (webhookError) {
        logger.error({ err: webhookError, mcNumber }, 'Error sending webhook response');
        // Try fallback to response_url if webhook fails
        if (response_url) {
          try {
            await axios.post(response_url, slackResponse, { timeout: 5000 });
          } catch (fallbackError) {
            logger.error({ err: fallbackError, mcNumber }, 'Error sending fallback response');
          }
        }
      }

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
          return res.send("Error: Could not refresh authentication. Please check logs or contact admin.");
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
        return res.send(userMessage);
      }
    }
  } // end while loop
}));

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Test endpoint for refresh token verification (for testing/debugging)
app.get('/test/refresh', verifyTestEndpointAuth, async (req, res) => {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ status: 'error', message: 'Not found' });
  }

  try {
    logger.info('Refresh token test endpoint called');
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
    logger.error({ err: error }, 'Error in refresh test endpoint');
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.use((err, req, res, _next) => {
  void _next;
  logger.error({
    err,
    request: {
      id: req.id,
      method: req.method,
      url: req.originalUrl
    }
  }, 'Unhandled application error');
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// Start server with database initialization
async function startServer() {
  await loadTokens();
  app.listen(port, () => {
    logger.info({ port }, 'Server is running');
  });
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
