# AGENTS.md

## Project Overview
This repository contains the `mcp-slackbot`, a Node.js application that integrates MyCarrierPortal (MCP) Carrier Risk Assessments into Slack using slash commands. It uses OAuth 2.0 for MCP authentication and stores tokens in a libSQL database to ensure persistence and rotation.

## Tech Stack
- **Runtime**: Node.js (>= 18.0.0)
- **Framework**: Express
- **Database**: libSQL (Turso)
- **Containerization**: Docker & Docker Compose
- **Language**: JavaScript

## Environment Variables
The following environment variables are required for the application to function correctly. Copy `.env.example` to `.env` to configure them.

| Variable | Description |
|----------|-------------|
| `BEARER_TOKEN` | Initial MyCarrierPortal access token |
| `REFRESH_TOKEN` | Initial MyCarrierPortal refresh token |
| `TOKEN_ENDPOINT_URL` | MyCarrierPortal token endpoint |
| `CLIENT_ID` | MyCarrierPortal username (for initial setup) |
| `CLIENT_SECRET` | MyCarrierPortal password (for initial setup) |
| `SLACK_SIGNING_SECRET`| Slack app signing secret |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `SLACK_BOT_TOKEN` | Slack bot token (xoxb-...) |
| `LIBSQL_URL` | URL for libSQL database (default: http://libsql:8081) |
| `PORT` | Application port (default: 3001) |

## Development

### Installation
```bash
npm install
```

### Running the Application
- **Standard**: `npm start` (or `node app.js`)
- **Development**: `npm run dev` (uses nodemon)
- **Docker**: `docker compose up`

### Testing
- **Run all tests**: `npm test`
- **Test Token**: `npm run test:token`
- **Test Refresh**: `npm run test:refresh`

**Note**: Integration tests in `tests/` require valid API credentials in the `.env` file or environment variables.

## Codebase Structure
- `app.js`: Main application entry point, Express server, and Slack command handlers.
- `db.js`: Database interaction logic (libSQL).
- `tests/`: Integration tests.
- `docker-compose.yml`: Docker services configuration.
- `README.md`: Detailed documentation for humans.

## Key Behaviors
- **Slack Commands**: The slash command handler acknowledges requests immediately with a 200 OK to avoid Slack timeouts. It then processes the API call asynchronously and sends the result to the `response_url`.
- **Token Rotation**: The app handles token refreshing automatically. If a 401 is received from MCP, it attempts to refresh the token using the stored refresh token.

## Instructions for Agents
1.  **Plan First**: Always create a plan using `set_plan` before making changes.
2.  **Verify**: Always verify your changes using `read_file`, `list_files`, or running tests (`npm test`).
3.  **Tests**: Run relevant tests after changes. If modifying API interactions, ensure you have valid credentials or mock them if appropriate.
4.  **Linting**: Ensure code adheres to the project's ESLint configuration (`npm run lint`).
5.  **Dependencies**: Use `npm` for package management.
