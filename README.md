# MCP Slackbot

A Slack bot that performs Carrier Risk Assessments with the MyCarrierPortal API and delivers the results directly inside Slack.

![MCP Slackbot Screenshot](./MCP-Slackbot-Screenshot.png)

## Prerequisites

- Go 1.21 or later
- A Slack workspace with permissions to create and install custom apps
- MyCarrierPortal API credentials (bearer token, refresh token, client ID, client secret, and token endpoint URL)

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/freightcognition/mcp-slackbot.git
   cd mcp-slackbot
   ```

2. **Create a `.env` file**

   Populate the following environment variables. The Go application loads them automatically on startup and will keep the file
   updated when access tokens are refreshed.

   | Variable | Description |
   | --- | --- |
   | `SLACK_APP_TOKEN` | Slack App-Level token (starts with `xapp-`) used for Socket Mode. |
   | `SLACK_BOT_TOKEN` | Slack Bot token (starts with `xoxb-`) used for Web API calls. |
   | `BEARER_TOKEN` | Current MyCarrierPortal API bearer token. |
   | `REFRESH_TOKEN` | MyCarrierPortal refresh token. |
   | `TOKEN_ENDPOINT_URL` | OAuth token refresh endpoint for MyCarrierPortal. |
   | `CLIENT_ID` | OAuth client ID issued for the MyCarrierPortal integration. |
   | `CLIENT_SECRET` | OAuth client secret issued for the MyCarrierPortal integration. |
   | `MCP_API_URL` *(optional)* | Override for the carrier preview endpoint. Defaults to the staging URL. |
   | `SLACK_DEBUG` *(optional)* | Set to `true` to enable verbose logging from the Slack client. |

## Running the bot locally

```bash
go run ./...
```

The process connects to Slack using Socket Mode and starts an auxiliary HTTP server exposing a health check at
`http://localhost:3001/health`.

## Running tests

```bash
go test ./...
```

The tests cover configuration loading, Slack message formatting, token refresh behaviour, MCP API retries, and the slash command
handler.

## Slack app configuration

1. **Create the app** – visit <https://api.slack.com/apps>, create a new app from scratch, and select your workspace.
2. **Enable Socket Mode** – under *Settings → Socket Mode*, enable the feature and generate an App-Level token. Set the token as
   `SLACK_APP_TOKEN` in your `.env` file.
3. **Install the app** – install the app to your workspace from *OAuth & Permissions* to obtain the bot token (`SLACK_BOT_TOKEN`).
   Add at least the `commands` and `chat:write` scopes.
4. **Create the slash command** – under *Features → Slash Commands*, create `/mcp`. Slack requires a valid HTTPS Request URL when
   saving the command; you can use a temporary public tunnel (e.g. `ngrok http 3001`) for validation. Once the app is running in
   Socket Mode, Slash command payloads are delivered over the WebSocket connection.

After installation invite the app to a channel and run `/mcp <MC number>` to retrieve the carrier's risk assessment. The bot will
acknowledge within three seconds and then post a formatted Block Kit message summarising the results.

## Token management

When the MyCarrierPortal API returns a 401 response the bot automatically refreshes the bearer token using the configured refresh
credentials. Successful refreshes update the in-memory tokens, the environment, and rewrite the `.env` file so that subsequent
process restarts use the latest credentials.

## Health check

An unauthenticated health endpoint is exposed at `GET /health` on port `3001`. It returns `{"status":"healthy"}` when the
process is ready to receive slash commands.

