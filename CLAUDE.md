# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**MCP Slackbot** is a Slack integration bot that executes Carrier Risk Assessments using the MyCarrierPortal API from within Slack workspaces. It's designed to streamline carrier vetting workflows for logistics and freight management teams.

**Author**: Anthony Fecarotta (freightCognition & linehaul.ai)
**License**: MIT
**Version**: 2.1.4
**Repository**: https://github.com/freightcognition/mcp-slackbot

## Architecture

### Technology Stack
- **Runtime**: Node.js >= 18.0.0
- **Framework**: Express.js
- **HTTP Client**: Axios
- **Security**: Crypto, tsscmp (timing-safe comparison)
- **Process Management**: PM2
- **Deployment**: Docker/Docker Compose

### Core Components

1. **Express Server** ([app.js](app.js))
   - Slack command handler (`/mcp`)
   - Token refresh endpoint (`/test/refresh`)
   - Request signature verification
   - Automatic bearer token refresh on expiration

2. **Authentication Flow**
   - Bearer token for API authentication
   - Refresh token mechanism for token renewal
   - OAuth2-style token endpoint integration
   - Automatic retry on 401 errors

3. **Slack Integration**
   - Slash command support
   - Signature verification for security
   - Webhook notifications
   - Response formatting for Slack UI

## Key Features

- **Carrier Risk Assessment**: Execute carrier lookups via `/mcp [DOT_NUMBER]` command
- **Automatic Token Refresh**: Handles expired tokens transparently
- **Secure Communication**: HMAC-SHA256 signature verification for Slack requests
- **Docker Support**: Containerized deployment with docker-compose
- **Testing Suite**: Comprehensive tests for token validation and refresh functionality

## File Structure

```
mcp-slackbot/
├── app.js                          # Main application server
├── package.json                     # Dependencies and scripts
├── Dockerfile                       # Container configuration
├── docker-compose.yml               # Docker orchestration
├── .env.example                     # Environment template
├── tests/
│   ├── test_preview.js             # Preview functionality tests
│   ├── test_refresh.js             # Token refresh tests
│   └── test_token.js               # Bearer token validation tests
├── .github/
│   └── workflows/                  # CI/CD pipelines
├── README.md                        # User documentation
└── CLAUDE.md                        # This file (AI context)
```

## Environment Variables

### Required Variables
- `BEARER_TOKEN`: MyCarrierPortal API bearer token
- `REFRESH_TOKEN`: Token for refreshing expired bearer tokens
- `TOKEN_ENDPOINT_URL`: OAuth2 token endpoint (e.g., `https://api.mycarrierpackets.com/token`)
- `CLIENT_ID`: OAuth2 client identifier
- `CLIENT_SECRET`: OAuth2 client secret
- `SLACK_BOT_TOKEN`: Slack bot OAuth token (xoxb-*)
- `SLACK_SIGNING_SECRET`: Slack app signing secret for request verification

### Optional Variables
- `SLACK_WEBHOOK_URL`: Incoming webhook URL for notifications
- `PORT`: Server port (default: 3001)

## Development Guidelines

### Code Style
- Use `const` for immutable variables
- Descriptive error messages with console logging
- Async/await for asynchronous operations
- Express middleware patterns for request handling

### Security Considerations
- Never commit `.env` files or credentials
- Always verify Slack request signatures
- Use timing-safe string comparison for secrets
- Sanitize user inputs from Slack commands
- Rotate tokens regularly

### Testing
```bash
npm test              # Run all tests
npm run test:token    # Test bearer token
npm run test:refresh  # Test token refresh
```

### Deployment
```bash
# Docker Compose (recommended)
docker compose up -d

# Node.js direct
npm install
npm start

# PM2 process manager
npm run pm2:start
npm run pm2:logs
```

## API Integration

### MyCarrierPortal API
- **Base URL**: Configured via environment
- **Authentication**: Bearer token in Authorization header
- **Token Refresh**: POST to TOKEN_ENDPOINT_URL with refresh_token grant type
- **Rate Limiting**: Consider API limits when handling requests

### Token Refresh Flow
1. API call returns 401 Unauthorized
2. Automatically trigger refresh token request
3. Update BEARER_TOKEN and REFRESH_TOKEN (if new one provided)
4. Retry original API call with new token
5. Return result to Slack user

## Slack Command Format

```
/mcp [DOT_NUMBER]
```

**Example**: `/mcp 12345`

Returns formatted carrier risk assessment data to the requesting user in Slack.

## Common Development Tasks

### Adding New Slack Commands
1. Register command in Slack App configuration
2. Add route handler in [app.js](app.js)
3. Implement business logic
4. Format response for Slack
5. Update documentation

### Modifying API Calls
1. Locate API call in [app.js](app.js)
2. Update endpoint/parameters
3. Handle new response structure
4. Update error handling
5. Test with `npm run test:token`

### Debugging
- Check container logs: `docker compose logs -f mcpslackbot`
- Monitor token refresh: `docker logs -f mcpslackbot | grep -i refresh`
- Test endpoints locally: `curl http://localhost:3001/test/refresh`
- Verify Slack signature: Check console logs for verification errors

## Troubleshooting

### Token Issues
- **401 errors**: Check BEARER_TOKEN validity
- **Refresh fails**: Verify REFRESH_TOKEN and TOKEN_ENDPOINT_URL
- **Token not updating**: Check file permissions in Docker volume mounts

### Slack Integration
- **Command not responding**: Verify Request URL in Slack app config
- **Signature verification fails**: Confirm SLACK_SIGNING_SECRET matches
- **Timeout errors**: Check if API calls complete within 3 seconds (Slack limit)

### Docker Deployment
- **Port conflicts**: Change PORT in .env
- **Container won't start**: Check `docker compose logs`
- **Environment variables not loading**: Verify `.env` file location and formatting

## Recent Changes

### Current Branch: `feature/lhlai-201-refresh-token-repair`
- Enhanced token refresh functionality
- Added comprehensive testing suite
- Updated documentation for testing workflows
- Improved error handling for token expiration

### Recent Commits
- Merged refresh token repair feature
- Added test scripts to package.json
- Enhanced README with testing instructions
- Implemented test endpoint for refresh validation

## Development Workflow

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `npm test` to validate
4. Update documentation if needed
5. Create pull request to `main`
6. GitHub Actions runs automated tests
7. Review and merge

## Contact & Support

**Maintainer**: freightCognition
**Issues**: https://github.com/freightcognition/mcp-slackbot/issues
**Keywords**: slack, slackbot, mycarrierportal, fakebizprez, linehaul.ai

## Notes for AI Assistants

- This project is production code for logistics/freight management
- Focus on security when suggesting changes (credentials, injection attacks)
- Token refresh is critical - test thoroughly after modifications
- Slack has 3-second timeout for command responses
- Consider Docker environment when suggesting file system operations
- All secrets must be in `.env`, never hardcoded
- Follow existing code patterns (Express middleware, async/await)
- Test commands in Docker before suggesting deployment
