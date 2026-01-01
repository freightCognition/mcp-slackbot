const { App, LogLevel } = require('@slack/bolt');
const axios = require('axios');
const express = require('express');
const qs = require('qs');
require('dotenv').config();

const { initDb, getTokens, saveTokens } = require('./db');
const { buildRiskBlocks } = require('./lib/riskFormatter');

const port = process.env.PORT || 3001;

let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;

const requiredEnv = {
  BEARER_TOKEN,
  REFRESH_TOKEN,
  TOKEN_ENDPOINT_URL,
  CLIENT_ID,
  CLIENT_SECRET,
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN
};

const missingEnv = Object.entries(requiredEnv)
  .filter(([_, value]) => !value)
  .map(([key]) => key);

if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

async function loadTokens() {
  try {
    await initDb();
    const dbTokens = await getTokens();
    if (dbTokens) {
      console.log('Loaded tokens from database');
      BEARER_TOKEN = dbTokens.bearerToken;
      REFRESH_TOKEN = dbTokens.refreshToken;
    } else {
      console.log('No tokens in database, saving from environment');
      await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);
    }
  } catch (error) {
    console.error('Error loading tokens from database:', error);
    console.log('Falling back to environment variables');
  }
}

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

async function fetchCarrierPreview(mcNumber, dotNumber) {
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      console.log(`Fetching data for MC number: ${mcNumber}, attempt ${attempt + 1}`);
      const apiResponse = await axios.post(
        'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier',
        null,
        {
          params: {
            docketNumber: mcNumber,
            ...(dotNumber ? { DOTNumber: dotNumber } : {})
          },
          headers: {
            Authorization: `Bearer ${BEARER_TOKEN}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (!apiResponse.data || apiResponse.data.length === 0) {
        console.log(`No data found for MC number: ${mcNumber}`);
        throw new Error('No data found for the provided MC number.');
      }

      const data = apiResponse.data[0];
      const { blocks, summaryText } = buildRiskBlocks(data);
      return { blocks, summaryText };
    } catch (error) {
      if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
        console.log('Access token expired or invalid. Attempting refresh...');
        const refreshed = await refreshAccessToken();
        if (refreshed.success) {
          console.log('Token refreshed. Retrying API call...');
          attempt++;
          continue;
        }
        console.error('Failed to refresh token. Aborting.');
        throw new Error('Authentication failed after refresh attempt.');
      }

      if (error.message === 'No data found for the provided MC number.') {
        throw error;
      }

      console.error('API call failed or max retries reached:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
      throw new Error('Error fetching data. Please try again later.');
    }
  }

  throw new Error('Unable to fetch carrier data after multiple attempts.');
}

const boltApp = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: LogLevel.INFO
});

function buildModal(triggerChannelId, defaults = {}) {
  return {
    type: 'modal',
    callback_id: 'mcp_carrier_modal',
    private_metadata: JSON.stringify({ channel_id: triggerChannelId }),
    title: {
      type: 'plain_text',
      text: 'MCP Lookup'
    },
    submit: {
      type: 'plain_text',
      text: 'Fetch'
    },
    close: {
      type: 'plain_text',
      text: 'Cancel'
    },
    blocks: [
      {
        type: 'input',
        block_id: 'mc_block',
        element: {
          type: 'plain_text_input',
          action_id: 'mc_input',
          initial_value: defaults.mcNumber || '',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 415186'
          }
        },
        label: {
          type: 'plain_text',
          text: 'MC Number'
        }
      },
      {
        type: 'input',
        optional: true,
        block_id: 'dot_block',
        element: {
          type: 'plain_text_input',
          action_id: 'dot_input',
          initial_value: defaults.dotNumber || '',
          placeholder: {
            type: 'plain_text',
            text: 'Optional DOT number'
          }
        },
        label: {
          type: 'plain_text',
          text: 'DOT Number'
        }
      }
    ]
  };
}

boltApp.command('/mcp', async ({ ack, body, client }) => {
  await ack();

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildModal(body.channel_id)
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    await client.chat.postEphemeral({
      channel: body.channel_id,
      user: body.user_id,
      text: 'Unable to open carrier lookup modal right now. Please try again later.'
    });
  }
});

boltApp.view('mcp_carrier_modal', async ({ ack, body, view, client }) => {
  const mcNumber = view.state.values.mc_block.mc_input.value?.trim();
  const dotNumber = view.state.values.dot_block?.dot_input?.value?.trim();
  const privateMetadata = view.private_metadata ? JSON.parse(view.private_metadata) : {};
  const targetChannel = privateMetadata.channel_id;
  const viewId = view.id;

  if (!mcNumber) {
    await ack({
      response_action: 'errors',
      errors: {
        mc_block: 'MC number is required.'
      }
    });
    return;
  }

  await ack({
    response_action: 'update',
    view: {
      type: 'modal',
      callback_id: 'mcp_carrier_modal_loading',
      title: {
        type: 'plain_text',
        text: 'MCP Lookup'
      },
      close: {
        type: 'plain_text',
        text: 'Close'
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Looking up MC Number *${mcNumber}*...`
          }
        }
      ]
    }
  });

  try {
    const { blocks, summaryText } = await fetchCarrierPreview(mcNumber, dotNumber);

    let channelId = targetChannel;
    if (!channelId) {
      const conversation = await client.conversations.open({ users: body.user.id });
      channelId = conversation.channel.id;
    }

    await client.chat.postMessage({
      channel: channelId,
      text: summaryText,
      blocks
    });

    await client.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        callback_id: 'mcp_carrier_modal_success',
        title: {
          type: 'plain_text',
          text: 'MCP Lookup'
        },
        close: {
          type: 'plain_text',
          text: 'Close'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Assessment posted to <#${channelId}>.`
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error handling modal submission:', error);
    const errorMessage = error.message || 'An unexpected error occurred.';
    await client.views.update({
      view_id: viewId,
      view: {
        type: 'modal',
        callback_id: 'mcp_carrier_modal_error',
        title: {
          type: 'plain_text',
          text: 'MCP Lookup'
        },
        close: {
          type: 'plain_text',
          text: 'Close'
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Error:* ${errorMessage}`
            }
          }
        ]
      }
    });
  }
});

const healthApp = express();
healthApp.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

async function start() {
  await loadTokens();
  await boltApp.start();
  healthApp.listen(port, () => {
    console.log(`Health endpoint available on port ${port}`);
  });
  console.log('⚡️ MCP Slackbot is running in Socket Mode powered by Bolt.');
}

start().catch(err => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
