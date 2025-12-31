# MCP Slackbot

A Slack bot for executing Carrier Risk Assessments using the MyCarrierPortal API within your Slack environment.

*Brought to you by Anthony Fecarotta of linehaul.ai*

![MCP Slackbot Screenshot](./MCP-Slackbot-Screenshot.png)

## Prerequisites

- Docker and Docker Compose (Recommended)
- A Slack workspace with permissions to add apps
- MyCarrierPortal API access (including Bearer Token, Refresh Token, and Token Endpoint URL)
- Node.js >= 18.0.0 (if not using Docker)

## Architecture

This application uses a **dual-container architecture** with Docker Compose, built on Slack's Bolt framework:

- **mcpslackbot**: A Node.js application using **Socket Mode** for secure, real-time communication with Slack.
- **libsql**: Database server (Turso libSQL) for persistent token storage.

The move to Bolt and Socket Mode modernizes the app, enhances security by removing the need for a public HTTP endpoint, and improves user experience with interactive modals.

Token persistence ensures OAuth refresh tokens survive container restarts and enables automatic token rotation without manual intervention.

## Quick Start with Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/linehaul-ai/mcp-slackbot.git
cd mcp-slackbot
```

### 2. Configure environment variables

Copy the example file:
```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```bash
# MyCarrierPortal API Configuration
BEARER_TOKEN=your_bearer_token_here
REFRESH_TOKEN=your_refresh_token_here
TOKEN_ENDPOINT_URL=https://api.mycarrierpackets.com/token
CLIENT_ID=your_mcp_username
CLIENT_SECRET=your_mcp_password

# Slack Configuration (Socket Mode)
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_APP_TOKEN=xapp-your-app-level-token

# Application Configuration
NODE_ENV=production
```

**Important Notes:**
- `CLIENT_ID` and `CLIENT_SECRET` are your MyCarrierPortal **username and password** (used for initial token generation only).
- These credentials are NOT sent with refresh token requests.
- Initial `BEARER_TOKEN` and `REFRESH_TOKEN` values are only used on first startup to seed the database.

### 3. Start the application

**Production mode:**
```bash
docker compose up -d
```

This command will:
1. Pull the libSQL server image
2. Build the Node.js application image
3. Create a persistent volume for token storage
4. Start both containers in the background

**Development mode (with logs visible):**
```bash
docker compose up
```

### 4. Verify deployment

Check that both containers are running:
```bash
docker compose ps
```

Expected output:
```
NAME                IMAGE                                    STATUS
libsql              ghcr.io/tursodatabase/libsql-server:latest   Up
mcpslackbot         mcpslackbot                              Up
```

View application logs:
```bash
# All logs
docker compose logs -f

# Just the app
docker compose logs -f mcpslackbot
```

Look for these startup messages:
- `Database initialized`
- `Loaded tokens from database` OR `No tokens in database, saving from environment`
- `⚡️ Bolt app is running!`

### 5. Test the `/mcp` command in Slack

- In any channel, type `/mcp` and press Enter.
- An interactive modal should appear asking for an MC number.
- Enter a valid MC number and click "Submit."
- The bot should post the Carrier Risk Assessment in the channel.

## Token Persistence & Rotation

### How It Works

1. **First Startup**: Tokens from environment variables are saved to the libSQL database.
2. **Subsequent Startups**: Tokens are loaded from the database.
3. **Token Refresh**: When an API call fails with a 401 error, the app automatically:
   - Calls the refresh endpoint with the current refresh token.
   - Receives a new access token and refresh token.
   - Saves both to the database.
   - Retries the failed API call.
4. **Container Restart**: Tokens persist in the libSQL volume and are automatically loaded.

## Slack App Configuration

To use this bot, you need to create a Slack App:

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click "Create New App".
2. Choose "From scratch", name your app, and select your workspace.

### Enable Socket Mode

1. Navigate to **Settings > Socket Mode**.
2. Enable the toggle for "Socket Mode".
3. Acknowledge the warning about event subscriptions.
4. Generate an **App-Level Token**. Name it something descriptive (e.g., `mcp-slackbot-token`).
5. Copy the token (it will start with `xapp-`). This is your `SLACK_APP_TOKEN`.

### Slash Commands

1. Navigate to **Features > Slash Commands**.
2. Click **Create New Command**.
3. Configure:
   - **Command:** `/mcp`
   - **Short Description:** "Fetch MCP Carrier Risk Assessment"
   - **Usage Hint:** `(opens a modal)`
4. Save. (No Request URL is needed for Socket Mode).

### Permissions (OAuth & Permissions)

1. Navigate to **Features > OAuth & Permissions**.
2. Add the following **Bot Token Scopes**:
   - `commands` - Required for slash commands.
   - `chat:write` - Required to send messages.
3. Click **Install to Workspace**.
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`). This is your `SLACK_BOT_TOKEN`.

### App Credentials

1. Navigate to **Settings > Basic Information**.
2. Find **Signing Secret** under "App Credentials".
3. Copy the secret. This is your `SLACK_SIGNING_SECRET`.

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BEARER_TOKEN` | Yes | MyCarrierPortal access token | `VyTeZfFdtMagZ03J...` |
| `REFRESH_TOKEN` | Yes | MyCarrierPortal refresh token | `a2afa1653b4b4b04...` |
| `TOKEN_ENDPOINT_URL` | Yes | Token refresh endpoint | `https://api.mycarrierpackets.com/token` |
| `CLIENT_ID` | Yes | MyCarrierPortal username | `your_username` |
| `CLIENT_SECRET` | Yes | MyCarrierPortal password | `your_password` |
| `SLACK_BOT_TOKEN` | Yes | Slack bot token (starts with `xoxb-`) | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Yes | Slack app signing secret | `1234567890abcdef...` |
| `SLACK_APP_TOKEN` | Yes | Slack app-level token for Socket Mode (starts with `xapp-`) | `xapp-...` |
| `NODE_ENV` | No | Environment mode | `production` or `development` |
| `LIBSQL_URL` | No | Database connection URL | `http://libsql:8081` (default) |
| `TEST_API_KEY` | No | API key for test endpoints | `secure_random_string` |

## Troubleshooting

### Containers won't start

- **Check logs:** `docker compose logs`
- **Common issues:**
  - Missing environment variables in `.env`.
  - Port 8081 already in use (change in `docker-compose.yml`).
  - Permission issues with Docker socket.

### Slack commands not working

- Ensure **Socket Mode** is enabled in your Slack App settings.
- Verify that `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, and `SLACK_APP_TOKEN` are correct.
- Check the application logs (`docker compose logs mcpslackbot`) for any connection errors.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Support

For issues or questions:
- GitHub Issues: https://github.com/linehaul-ai/mcp-slackbot/issues
- Contact: Anthony Fecarotta (anthony@linehaul.ai)
