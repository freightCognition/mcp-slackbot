const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const fs = require('fs');
const qs = require('qs');

// Read environment variables
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

// Function to format risk level emoji
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

// Function to get risk level text
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
// eslint-disable-next-line no-unused-vars
function formatInfractions(infractions) {
  if (!infractions || infractions.length === 0) {
    return "No infractions found.";
  }
  return infractions.map(infraction => {
    return `- ${infraction.RuleText}: ${infraction.RuleOutput} (${infraction.Points} points)`;
  }).join('\n');
}

// Function to preview carrier
async function previewCarrier(mcNumber, dotNumber = '976560') {
  let attempt = 0;
  const maxAttempts = 2; // Original attempt + 1 retry after refresh

  while (attempt < maxAttempts) {
    try {
      console.log(`Fetching data for MC number: ${mcNumber}, DOT: ${dotNumber}, attempt ${attempt + 1}`);
      const apiResponse = await axios.post(
        'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier',
        null,
        {
          params: { 
            DOTNumber: dotNumber,
            docketNumber: mcNumber 
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
        return { success: false, message: 'No data found for the provided MC number.' };
      }

      const data = apiResponse.data[0];
      console.log(`Data received for MC number: ${mcNumber}`);
      console.log('Carrier Name:', data.CompanyName);
      console.log('DOT:', data.DotNumber);
      console.log('MC:', data.DocketNumber);
      
      if (data.RiskAssessmentDetails) {
        console.log('Risk Assessment:');
        console.log(`Overall: ${getRiskLevelEmoji(data.RiskAssessmentDetails.TotalPoints)} ${getRiskLevel(data.RiskAssessmentDetails.TotalPoints)} (${data.RiskAssessmentDetails.TotalPoints} points)`);
        
        // Log categories
        const categories = ['Authority', 'Insurance', 'Operation', 'Safety', 'Other'];
        categories.forEach(category => {
          const categoryData = data.RiskAssessmentDetails[category];
          if (categoryData) {
            console.log(`- ${category}: ${getRiskLevelEmoji(categoryData.TotalPoints)} ${getRiskLevel(categoryData.TotalPoints)} (${categoryData.TotalPoints} points)`);
            if (categoryData.Infractions && categoryData.Infractions.length > 0) {
              console.log('  Infractions:');
              categoryData.Infractions.forEach(inf => {
                console.log(`  * ${inf.RuleText}: ${inf.RuleOutput} (${inf.Points} points)`);
              });
            }
          }
        });
      }

      return { success: true, data: data };

    } catch (error) {
      if (error.response && error.response.status === 401 && attempt < maxAttempts - 1) {
        console.log('Access token expired or invalid. Attempting refresh...');
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          console.log('Token refreshed. Retrying API call...');
          attempt++;
          // continue to retry the while loop
        } else {
          console.error('Failed to refresh token. Aborting.');
          return { 
            success: false, 
            message: "Error: Could not refresh authentication." 
          };
        }
      } else {
        console.error('API call failed or max retries reached:', error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        let userMessage = 'Error fetching data. Please try again later.';
        if (error.response && error.response.status === 401) {
          userMessage = 'Authentication failed even after attempting to refresh.';
        }
        return { 
          success: false, 
          message: userMessage,
          error: error.message,
          responseError: error.response ? error.response.data : null
        };
      }
    }
  } // end while loop
}

// Main function
async function runTest() {
  // MC number to test
  const mcNumber = process.argv[2] || '415186';
  const dotNumber = process.argv[3] || '976560';
  
  console.log(`Starting carrier preview test for MC: ${mcNumber}, DOT: ${dotNumber}`);
  
  const result = await previewCarrier(mcNumber, dotNumber);
  
  if (result.success) {
    console.log('\nTest completed successfully!');
  } else {
    console.log('\nTest failed:', result.message);
    if (result.error) {
      console.log('Error details:', result.error);
    }
  }
}

// Run the test
runTest();
