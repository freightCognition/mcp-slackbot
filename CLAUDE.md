# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**MCP Slackbot** is a Slack integration bot that executes Carrier Risk Assessments using the MyCarrierPortal API from within Slack workspaces. It's designed to streamline carrier vetting workflows for logistics and freight management teams.

**Author**: Anthony Fecarotta (freightCognition & linehaul.ai)
**License**: MIT
**Version**: 2.1.4
**Repository**: https://github.com/freightcognition/mcp-slackbot

## Architecture

### Technology Stack
- **Runtime**: Bun >= 1.0.0
- **Framework**: @slack/bolt (Socket Mode)
- **HTTP Client**: Axios
- **Logging**: Pino
- **Process Management**: PM2
- **Deployment**: Docker/Docker Compose

### Core Components

1. **Bolt App with Socket Mode** ([app.js](app.js))
   - Slack command handler (`/mcp`) using `app.command()`
   - Health check endpoint via `customRoutes` on port 3001
   - Global error handler via `app.error()`
   - Graceful shutdown handlers (SIGTERM, SIGINT)
   - Automatic bearer token refresh on expiration with mutex

2. **Authentication Flow**
   - Bearer token for MyCarrierPortal API authentication
   - Refresh token mechanism for token renewal
   - Automatic retry on 401 errors with token refresh

3. **Slack Integration**
   - Socket Mode (WebSocket connection to Slack)
   - Slash command support via Bolt SDK
   - Signature verification handled by Bolt
   - Response formatting for Slack Block Kit UI

## Key Features

- **Carrier Risk Assessment**: Execute carrier lookups via `/mcp [DOT_NUMBER]` command
- **Automatic Token Refresh**: Handles expired tokens transparently with mutex to prevent race conditions
- **Socket Mode**: No public URL required - connects via WebSocket
- **Health Check Endpoint**: `/health` on port 3001 for container orchestration
- **Docker Support**: Containerized deployment with docker-compose and health checks


## File Structure

```
mcp-slackbot/
├── app.js                          # Main Bolt application
├── db.js                           # LibSQL database operations for token persistence
├── logger.js                       # Pino structured logging configuration
├── package.json                    # Dependencies and scripts
├── bun.lock                        # Bun lockfile
├── Dockerfile                      # Container configuration
├── docker-compose.yml              # Docker orchestration with health checks
├── .env.example                    # Environment template
├── tests/
│   ├── test_preview.js             # Preview functionality tests
│   ├── test_refresh.js             # Token refresh tests
│   └── test_token.js               # Bearer token validation tests
├── .github/
│   └── workflows/                  # CI/CD pipelines
├── README.md                       # User documentation
└── CLAUDE.md                       # This file (AI context)
```

## Environment Variables

### Required Variables
- `BEARER_TOKEN`: MyCarrierPortal API bearer token
- `REFRESH_TOKEN`: Token for refreshing expired bearer tokens
- `TOKEN_ENDPOINT_URL`: OAuth2 token endpoint (e.g., `https://api.mycarrierpackets.com/token`)
- `SLACK_BOT_TOKEN`: Slack bot OAuth token (xoxb-*)
- `SLACK_SIGNING_SECRET`: Slack app signing secret
- `SLACK_APP_TOKEN`: Slack app-level token for Socket Mode (xapp-*)

### Optional Variables
- `LIBSQL_URL`: LibSQL database URL for token persistence (default: `http://localhost:8081`)
- `LOG_LEVEL`: Pino log level (default: `info`)

## Development Guidelines

### Code Style
- Use `const` for immutable variables
- Descriptive error messages with structured logging (Pino)
- Async/await for asynchronous operations
- Bolt SDK patterns for Slack interactions (`ack()`, `respond()`)
- Helper functions for error-prone operations (`safeRespond()`)

### Security Considerations
- Never commit `.env` files or credentials
- Slack signature verification handled by Bolt SDK
- Sanitize user inputs from Slack commands
- Rotate tokens regularly
- Database failures are logged but don't crash the app

### Testing
```bash
bun test              # Run all tests
bun run test:token    # Test bearer token
bun run test:refresh  # Test token refresh
```

### Deployment
```bash
# Docker Compose (recommended)
docker compose up -d

# Bun direct
bun install
bun run start

# PM2 process manager
bun run pm2:start
bun run pm2:logs
```

## API Integration

### MyCarrierPortal API
- **Base URL**: Configured as `CARRIER_API_URL` constant in app.js
- **Authentication**: Bearer token in Authorization header
- **Token Refresh**: POST to TOKEN_ENDPOINT_URL with refresh_token grant type
- **Rate Limiting**: Consider API limits when handling requests

### Token Refresh Flow
1. API call returns 401 Unauthorized
2. Mutex ensures only one refresh runs at a time
3. Refresh token request to TOKEN_ENDPOINT_URL
4. Update BEARER_TOKEN and REFRESH_TOKEN (if new one provided)
5. Retry original API call with new token
6. Return result to Slack user

## Slack Command Format

```
/mcp [DOT_NUMBER]
```

**Example**: `/mcp 12345`

Returns formatted carrier risk assessment data to the requesting user in Slack.

## Common Development Tasks

### Adding New Slack Commands
1. Register command in Slack App configuration
2. Add `app.command('/newcommand', async ({ command, ack, respond }) => {...})` handler
3. Call `await ack()` immediately
4. Implement business logic
5. Use `safeRespond()` for error-safe responses
6. Update documentation

### Modifying API Calls
1. Locate API call in [app.js](app.js)
2. Update endpoint/parameters (use `CARRIER_API_URL` constant)
3. Handle new response structure
4. Update error handling
5. Test with `bun run test:token`

### Debugging
- Check container logs: `docker compose logs -f mcpslackbot`
- Monitor token refresh: `docker logs -f mcpslackbot | grep -i refresh`
- Health check: `curl http://localhost:3001/health`
- Check database status in health response

## Troubleshooting

### Token Issues
- **401 errors**: Check BEARER_TOKEN validity
- **Refresh fails**: Verify REFRESH_TOKEN and TOKEN_ENDPOINT_URL
- **Token not persisting**: Check LibSQL connectivity in health endpoint
- **Race conditions**: Token refresh mutex should handle concurrent requests

### Slack Integration
- **Command not responding**: Verify SLACK_APP_TOKEN and Socket Mode is enabled
- **Connection drops**: Check SLACK_APP_TOKEN hasn't expired
- **No Socket Mode**: Ensure app is configured for Socket Mode in Slack API settings

### Docker Deployment
- **Container won't start**: Check `docker compose logs`
- **Health check failing**: Verify port 3001 is exposed
- **Environment variables not loading**: Verify `.env` file location and formatting

## Recent Changes

### Current Branch: `refactor-bolt-socket-mode`
- Migrated from Express.js to @slack/bolt with Socket Mode
- Removed manual signature verification (handled by Bolt)
- Added health check endpoint via `customRoutes`
- Added global error handler via `app.error()`
- Added graceful shutdown handlers
- Added token refresh mutex for race condition prevention
- Improved error handling with `safeRespond()` wrapper
- Database availability tracking and surfacing

## Development Workflow

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `bun test` to validate
4. Run `bun run lint` to check code style
5. Update documentation if needed
6. Create pull request to `main`
7. GitHub Actions runs automated tests
8. Review and merge

## Contact & Support

**Maintainer**: freightCognition
**Issues**: https://github.com/freightcognition/mcp-slackbot/issues
**Keywords**: slack, slackbot, mycarrierportal, fakebizprez, linehaul.ai

## Notes for AI Assistants

- This project is production code for logistics/freight management
- Focus on security when suggesting changes (credentials, injection attacks)
- Token refresh is critical - test thoroughly after modifications
- Socket Mode removes the 3-second Slack timeout constraint
- Consider Docker environment when suggesting file system operations
- All secrets must be in `.env`, never hardcoded
- Follow existing code patterns (Bolt SDK, async/await, safeRespond)
- Use `CARRIER_API_URL` constant for API endpoint
- Test commands in Docker before suggesting deployment
- Health endpoint available at `http://localhost:3001/health`
