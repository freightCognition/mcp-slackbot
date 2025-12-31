const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const qs = require('qs');
const { createClient } = require('@libsql/client');

// Database connection
const db = createClient({
  url: process.env.LIBSQL_URL || 'http://localhost:8080'
});

// Environment variables (fallback)
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;

// Load tokens from database
async function loadTokens() {
  try {
    const result = await db.execute('SELECT bearer_token, refresh_token FROM tokens WHERE id = 1');
    if (result.rows.length > 0) {
      BEARER_TOKEN = result.rows[0].bearer_token;
      REFRESH_TOKEN = result.rows[0].refresh_token;
      console.log('Loaded tokens from database');
    }
  } catch (error) {
    console.log('Could not load from database, using environment variables');
  }
}

// Save tokens to database
async function saveTokens(bearerToken, refreshToken) {
  await db.execute({
    sql: `INSERT INTO tokens (id, bearer_token, refresh_token, updated_at)
          VALUES (1, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            bearer_token = excluded.bearer_token,
            refresh_token = excluded.refresh_token,
            updated_at = datetime('now')`,
    args: [bearerToken, refreshToken]
  });
  console.log('Tokens saved to database');
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

    console.log('Response received:', JSON.stringify(response.data, null, 2));

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;

    if (!newAccessToken) {
      throw new Error('New access token not found in refresh response');
    }

    console.log('Access token refreshed successfully.');
    BEARER_TOKEN = newAccessToken;

    if (newRefreshToken) {
      console.log('New refresh token received.');
      REFRESH_TOKEN = newRefreshToken;
    }

    // Save to database
    await saveTokens(BEARER_TOKEN, REFRESH_TOKEN);

    return true;
  } catch (error) {
    console.error('Error refreshing access token:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
    return false;
  }
}

// Run the test
async function runTest() {
  if (!TOKEN_ENDPOINT_URL) {
    console.error('TOKEN_ENDPOINT_URL environment variable is required');
    process.exit(1);
  }

  await loadTokens();

  if (!REFRESH_TOKEN) {
    console.error('REFRESH_TOKEN not found in database or environment');
    process.exit(1);
  }

  console.log('Starting token refresh test...');
  console.log('Current Bearer Token (first 20 chars):', BEARER_TOKEN ? BEARER_TOKEN.substring(0, 20) + '...' : 'NOT SET');
  console.log('Current Refresh Token:', REFRESH_TOKEN ? REFRESH_TOKEN.substring(0, 20) + '...' : 'NOT SET');

  const result = await refreshAccessToken();

  if (result) {
    console.log('Test successful!');
    console.log('New Bearer Token (first 20 chars):', BEARER_TOKEN.substring(0, 20) + '...');
    console.log('New Refresh Token:', REFRESH_TOKEN.substring(0, 20) + '...');
    process.exit(0);
  } else {
    console.error('Test failed.');
    process.exit(1);
  }
}

runTest().catch(error => {
  console.error('Unexpected error in test:', error);
  process.exit(1);
});
