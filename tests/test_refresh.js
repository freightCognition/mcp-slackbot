const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');

// Environment variables
let BEARER_TOKEN = process.env.BEARER_TOKEN;
let REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const TOKEN_ENDPOINT_URL = process.env.TOKEN_ENDPOINT_URL;

// Function to update .env file (copied from app.js)
const envFilePath = path.resolve(__dirname, '../.env');
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

// Function to refresh the access token (copied from app.js)
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
    return false;
  }
}

// Run the test
async function runTest() {
  console.log('Starting token refresh test...');
  console.log('Current Bearer Token (first 20 chars):', BEARER_TOKEN.substring(0, 20) + '...');
  console.log('Current Refresh Token:', REFRESH_TOKEN);
  
  const result = await refreshAccessToken();
  
  if (result) {
    console.log('Test successful!');
    console.log('New Bearer Token (first 20 chars):', BEARER_TOKEN.substring(0, 20) + '...');
    console.log('New Refresh Token:', REFRESH_TOKEN);
  } else {
    console.log('Test failed.');
  }
}

runTest();