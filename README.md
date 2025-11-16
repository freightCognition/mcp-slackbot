# MCP Slackbot (Go Edition)

A Slack bot for executing Carrier Risk Assessments using the MyCarrierPortal API within your Slack environment, refactored in Go.

*Brought to you by Anthony Fecarotta of freightCognition & linehaul.ai*

![MCP Slackbot Screenshot](./MCP-Slackbot-Screenshot.png)

## Prerequisites

- Docker and Docker Compose (Recommended)
- A Slack workspace with permissions to add apps
- MyCarrierPortal API access (including Bearer Token, Refresh Token, and Token Endpoint URL)
- Go >= 1.18 (if not using Docker)

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
        *   `SLACK_APP_TOKEN`: Your Slack app-level token (starts with `xapp-`).
        *   `SLACK_BOT_TOKEN`: Your Slack bot's token (starts with `xoxb-`).
        *   `BEARER_TOKEN`: Your MyCarrierPortal API bearer token.
        *   `REFRESH_TOKEN`: Your MyCarrierPortal API refresh token.
        *   `TOKEN_ENDPOINT_URL`: The URL for the MyCarrierPortal token endpoint (e.g., `https://api.mycarrierpackets.com/token`).
        *   `CLIENT_ID`: Your MyCarrierPortal API client ID.
        *   `CLIENT_SECRET`: Your MyCarrierPortal API client secret.

3.  **Start the application:**
    ```bash
    docker compose up --build -d
    ```

4.  **Verify the application is running:**
    ```bash
    docker compose ps
    docker compose logs -f
    ```

## Alternative Deployment Methods (Without Docker)

1.  **Install dependencies:**
    ```bash
    go mod tidy
    ```

2.  **Configure environment variables:**
    Create a `.env` file in the root of the project (as described in step 2 of the Docker setup).

3.  **Run the application:**
    ```bash
    go run main.go
    ```

## Slack App Configuration for Socket Mode

1.  Go to [https://api.slack.com/apps](https://api.slack.com/apps) and create a new app.
2.  **Enable Socket Mode:**
    *   Navigate to "Settings" -> "Socket Mode".
    *   Enable Socket Mode.
3.  **Generate an App-Level Token:**
    *   Under "Tokens for Your Workspace", generate a new token with the `connections:write` scope.
    *   This will be your `SLACK_APP_TOKEN` (starts with `xapp-`).
4.  **Slash Commands:**
    *   Navigate to "Features" -> "Slash Commands".
    *   Create a new command (e.g., `/mcp`).
    *   You **do not** need to provide a Request URL when using Socket Mode.
5.  **Permissions (OAuth & Permissions):**
    *   Navigate to "Features" -> "OAuth & Permissions".
    *   Add the `chat:write` and `commands` scopes.
    *   Install the app to your workspace to generate the **Bot User OAuth Token** (`SLACK_BOT_TOKEN`).

## Health Check

A health check endpoint is available at `http://localhost:3001/health`.

## Running Tests

To run the unit tests, use the following command:
```bash
go test ./...
```
