# MCP Slackbot

A Slack bot for executing Carrier Risk Assessments using the MyCarrierPortal API within your Slack environment.

*Brought to you by Anthony Fecarotta of freightCognition & linehaul.ai*

![MCP Slackbot Screenshot](./MCP-Slackbot-Screenshot.png)

## Prerequisites

- Docker and Docker Compose (Recommended)
- A Slack workspace with permissions to add apps
- MyCarrierPortal API access (including Bearer Token, Refresh Token, and Token Endpoint URL)
- Node.js >= 18.0.0 (if not using Docker)

## Quick Start with Docker Compose

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/freightcognition/mcp-slackbot.git
    cd mcp-slackbot
    ```
2.  **Configure environment variables:**
    *   Copy `.env.example` to `.env`:
        ```bash
        cp .env.example .env
        ```
    *   Edit `.env` and fill in your credentials:
        *   `BEARER_TOKEN`: Your MyCarrierPortal API bearer token.
        *   `REFRESH_TOKEN`: Your MyCarrierPortal API refresh token.
        *   `TOKEN_ENDPOINT_URL`: The URL for the MyCarrierPortal token endpoint (e.g., `https://api.mycarrierpackets.com/token`).
        *   `SLACK_BOT_TOKEN`: Your Slack bot's token (starts with `xoxb-`).
        *   `SLACK_SIGNING_SECRET`: Your Slack app's signing secret.
        *   `SLACK_WEBHOOK_URL`: Your Slack incoming webhook URL (optional, if used for specific notifications).
        *   `PORT`: The port number for the application (default: `3001`). You usually don't need to change this unless there's a port conflict on your server.

3.  **Start the application:**
    *   **Production mode:**
        ```bash
        docker compose up -d
        ```
    *   **Development mode (with hot-reloading and debugging):**
        If you have a `docker-compose.debug.yml` (or similar for development):
        ```bash
        docker compose -f docker-compose.debug.yml up
        ```
        (Adjust the command if your development compose file has a different name.)

4.  **Verify the application is running:**
    ```bash
    # Check container status
    docker compose ps

    # View logs
    docker compose logs -f mcpslackbot
    ```
    (Assuming your service is named `mcpslackbot` in `docker-compose.yml`)

## Alternative Deployment Methods (Without Docker)

If you prefer not to use Docker, you can run the application directly using Node.js.

### Prerequisites for Direct Deployment
- Node.js >= 18.0.0
- npm (Node Package Manager)

### Setup and Running

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Configure environment variables:**
    Create a `.env` file in the root of the project (as described in step 2 of the Docker setup) with all the necessary tokens and URLs.

3.  **Run the application:**
    *   **Development mode (e.g., using `nodemon` if configured in `package.json`):**
        ```bash
        npm run dev
        ```
        (Check your `package.json` for the exact development script command.)
    *   **Production mode (e.g., using `pm2` or just `node`):**
        ```bash
        npm start
        ```
        or, if using PM2 (ensure it's installed: `npm install -g pm2`):
        ```bash
        npm run pm2:start  # Or pm2 start app.js --name mcp-slackbot
        npm run pm2:logs   # Or pm2 logs mcp-slackbot
        npm run pm2:stop   # Or pm2 stop mcp-slackbot
        ```
        (Check your `package.json` for `pm2` scripts.)


## Slack App Configuration

To use this bot, you need to create a Slack App:

1.  Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click "Create New App".
2.  Choose "From scratch".
3.  Name your app (e.g., "MCP Bot") and select your workspace.
4.  **Slash Commands:**
    *   Navigate to "Features" -> "Slash Commands".
    *   Click "Create New Command".
    *   **Command:** `/mcp` (or your preferred command)
    *   **Request URL:** `https://your-public-url.com/slack/commands` (This needs to be the publicly accessible URL where your bot is running. For local development, you'll need a tunneling service like ngrok: `ngrok http 3001`).
    *   **Short Description:** e.g., "Fetch MCP Carrier Risk Assessment"
    *   Save the command.
5.  **Event Subscriptions (Optional but Recommended for more interactive features):**
    *   Navigate to "Features" -> "Event Subscriptions".
    *   Toggle "Enable Events" to ON.
    *   **Request URL:** `https://your-public-url.com/slack/events` (If using Event Subscriptions, update this to your events endpoint. It's often the same as Slash Commands but can be different). The URL will be verified.
    *   You might subscribe to specific bot events if needed by your bot's functionality.
6.  **Permissions (OAuth & Permissions):**
    *   Navigate to "Features" -> "OAuth & Permissions".
    *   **Bot Token Scopes:** Add necessary scopes. At a minimum, you'll likely need:
        *   `commands` (for slash commands)
        *   `chat:write` (to send messages)
        *   Possibly others depending on functionality (e.g., `users:read` if you need user info).
    *   Install the app to your workspace. This will generate the **Bot User OAuth Token** (`SLACK_BOT_TOKEN` starting with `xoxb-`). 
7.  **App Credentials:**
    *   Navigate to "Settings" -> "Basic Information".
    *   Find your **Signing Secret** under "App Credentials" (`SLACK_SIGNING_SECRET`).

## Environment Variables Summary

-   **`BEARER_TOKEN`**
    -   **Description:** MyCarrierPortal API bearer token.
    -   **Example:** `your_long_bearer_token_here`
    -   **Required:** Yes

-   **`REFRESH_TOKEN`**
    -   **Description:** MyCarrierPortal API refresh token.
    -   **Example:** `your_refresh_token_here`
    -   **Required:** Yes

-   **`TOKEN_ENDPOINT_URL`**
    -   **Description:** MyCarrierPortal API token refresh endpoint.
    -   **Example:** `https://api.mycarrierpackets.com/token`
    -   **Required:** Yes

-   **`SLACK_BOT_TOKEN`**
    -   **Description:** Slack Bot User OAuth Token.
    -   **Example:** `xoxb-your-slack-bot-token`
    -   **Required:** Yes

-   **`SLACK_SIGNING_SECRET`**
    -   **Description:** Slack App Signing Secret.
    -   **Example:** `your_slack_signing_secret`
    -   **Required:** Yes

-   **`SLACK_WEBHOOK_URL`**
    -   **Description:** Slack Incoming Webhook URL (optional).
    -   **Example:** `https://hooks.slack.com/services/...`
    -   **Required:** No

-   **`PORT`**
    -   **Description:** Port the application listens on.
    -   **Example:** `3001`
    -   **Required:** No

## Testing

The `package.json` contains several test scripts for verifying the application functionality.

### Available Test Scripts

- `npm test` - Runs all tests (preview, refresh token, and bearer token)
- `npm run test:token` - Tests the bearer token against the API
- `npm run test:refresh` - Tests the refresh token functionality

### Testing Refresh Token Functionality

The refresh token is critical for maintaining API access. Here are several ways to verify it's working correctly:

#### 1. Local Testing (Node.js)

Ensure your `.env` file has all required variables (`REFRESH_TOKEN`, `TOKEN_ENDPOINT_URL`, `CLIENT_ID`, `CLIENT_SECRET`).

```bash
# Test just the refresh token
npm run test:refresh

# Or run the test directly
node tests/test_refresh.js

# Run all tests (includes refresh token test)
npm test
```

**Expected output on success:**
- "Attempting to refresh access token..."
- "Access token refreshed successfully."
- "New refresh token received." (if provided)
- "Test successful!"

#### 2. Local Testing with Docker

```bash
# Build the image
docker build -t mcpslackbot .

# Run the container
docker run -d --name mcpslackbot-test \
  --env-file .env \
  -p 3001:3001 \
  mcpslackbot

# Wait a moment for it to start
sleep 5

# Test the refresh token
docker exec mcpslackbot-test node tests/test_refresh.js

# Clean up
docker stop mcpslackbot-test
docker rm mcpslackbot-test
```

#### 3. Testing via HTTP Endpoint

If the application is running (locally or in production), you can test the refresh token via an HTTP endpoint:

```bash
# Test the refresh token endpoint
curl http://localhost:3001/test/refresh

# With better formatting (if you have jq installed)
curl http://localhost:3001/test/refresh | jq

# For production (replace with your server URL)
curl https://your-production-server:3001/test/refresh
```

**Expected JSON response:**
```json
{
  "status": "success",
  "message": "Token refreshed successfully",
  "newTokenPrefix": "TM8GfS8N7MusRc5Q_6Nm...",
  "hasNewRefreshToken": true
}
```

You can also open the endpoint directly in your browser:
```
http://localhost:3001/test/refresh
```

#### 4. Testing in Production

**Via SSH into your production server:**

```bash
# SSH into your server
ssh user@your-production-server

# Test the refresh token directly
docker exec mcpslackbot node tests/test_refresh.js

# Test via HTTP endpoint
curl http://localhost:3001/test/refresh

# Monitor logs for refresh activity
docker logs -f mcpslackbot | grep -i refresh
```

**Automatic verification during deployment:**

The GitHub Actions deployment workflow automatically tests the refresh token after deployment. Check the "Test refresh token" step in your GitHub Actions logs to verify it passed.

#### 5. Real-World Scenario Testing

To verify automatic refresh when a token expires:

1. Temporarily set an expired `BEARER_TOKEN` in your environment
2. Restart the container/application
3. Send a Slack command: `/mcp 12345`
4. Check your server logs - you should see:
   - "Access token expired or invalid. Attempting refresh..."
   - "Attempting to refresh access token..."
   - "Access token refreshed successfully."
   - "Token refreshed. Retrying API call..."

#### 6. Monitoring Refresh Token Activity

**Watch logs continuously:**

```bash
# Monitor logs for any refresh token activity
docker logs -f mcpslackbot | grep -i -E "(refresh|token|401)"

# Or view all logs
docker logs -f mcpslackbot
```

**What to look for:**

✅ **Success indicators:**
- "Access token refreshed successfully."
- "New refresh token received." (if provided by API)
- API calls succeed after token refresh

❌ **Failure indicators:**
- "Error refreshing access token: ..."
- "Refresh token might be invalid or expired..."
- API calls fail with 401 even after refresh attempt

### Testing Bearer Token

To test your bearer token against the API:

```bash
# Using Docker
docker compose run --rm mcpslackbot npm run test:token

# Without Docker
npm run test:token
```

## Security Notes

-   **Never commit your `.env` file (or any file with real credentials) to version control.** The `.gitignore` file should already list `.env`.
-   Keep your API tokens and secrets secure.
-   Consider using a secrets management solution for production environments.
-   Regularly rotate your credentials if possible.
-   The `.env.example` file is a template and should **never** contain real credentials.

## License

This project is licensed under version 3 of the GNU Affero General Public License (AGPL-3.0). See the `LICENSE.TXT` file for details.
