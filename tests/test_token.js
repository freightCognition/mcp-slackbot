require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');

async function testBearerToken() {
  try {
    const response = await axios.post(
      'https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier',
      null,
      {
        params: { 
          DOTNumber: '976560',
          docketNumber: '415186'
        },
        headers: {
          Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('API request successful. Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error occurred:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testBearerToken();
