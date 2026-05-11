# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**MCP Slackbot** is a Slack integration bot that executes Carrier Risk Assessments using the MyCarrierPortal API from within Slack workspaces. It provides a multi-step wizard modal for carrier vetting, contact selection, and Intellivite invitation workflows for logistics and freight management teams.

**Author**: Anthony Fecarotta (freightCognition & linehaul.ai)
**License**: MIT
**Version**: 3.0.0
**Repository**: https://github.com/freightcognition/risk-slackbot

## Architecture

### Technology Stack

- **Runtime**: Node.js >= 22.0.0
- **Package Manager**: pnpm >= 10.0.0 (declared via `packageManager` in package.json)
- **Framework**: @slack/bolt (Socket Mode)
- **HTTP Client**: Axios
- **Database**: LibSQL (token persistence + audit logging)
- **Logging**: Pino
- **Error Monitoring**: Sentry (@sentry/node, optional via `SENTRY_DSN`)
- **Test Runner**: Vitest
- **Process Management**: PM2
- **Deployment**: Docker/Docker Compose

### Core Components

1. **Bolt App with Socket Mode** ([app.js](app.js))
   - Slack command handler (`/risk`) using `app.command()`
   - Multi-step wizard modal (4 steps) with view push/update
   - Action handlers for wizard navigation, pagination, and contact selection
   - Health check endpoint via `customRoutes` on port 3001
   - Global error handler via `app.error()`
   - Graceful shutdown handlers (SIGTERM, SIGINT)
   - Automatic bearer token refresh on expiration with mutex

2. **Authentication Flow**
   - Bearer token for MyCarrierPortal API authentication
   - Refresh token mechanism with CLIENT_ID/CLIENT_SECRET
   - Token persistence in LibSQL database
   - Automatic retry on 401 errors with token refresh

3. **Slack Integration**
   - Socket Mode (WebSocket connection to Slack)
   - Slash command (`/risk`) via Bolt SDK
   - Multi-step modal wizard with Block Kit UI
   - Channel broadcast of risk assessment summaries
   - Signature verification handled by Bolt

4. **Database Layer** ([db.js](db.js))
   - LibSQL for token persistence across restarts
   - Audit logging for invite/decline actions
   - Graceful fallback when database is unavailable

5. **Error Monitoring** ([sentry-init.js](sentry-init.js))
   - Sentry SDK initialized at process start when `SENTRY_DSN` is set
   - No-op when DSN is absent — logs a warning and continues
   - Captures Bolt errors via `app.error()` and `unhandledRejection`/`uncaughtException` handlers
   - Sample rate controlled by `SENTRY_TRACES_SAMPLE_RATE` (clamped to [0,1])
   - Sensitive data (tokens, secrets, bearer headers) sanitized before send — see `logger.js` and `tests/app_sentry_sanitization.test.js`
   - Graceful flush on shutdown via `Sentry.close(2000)`

## Key Features

- **Carrier Risk Assessment Wizard**: 4-step modal wizard initiated via `/risk [DOT_NUMBER]`
  - Step 1: Carrier overview (name, MC#, DOT#, risk score, authority status)
  - Step 2: Incident reports with pagination
  - Step 3: VIN verifications with pagination (10 per page)
  - Step 4: Contact selection or manual email entry for Intellivite invitation
- **Intellivite Integration**: Send carrier onboarding invitations via email
- **Channel Broadcast**: Risk assessment summary posted to the channel on command
- **Active Assessment Guard**: Prevents concurrent assessments in the same channel
- **Automatic Token Refresh**: Handles expired tokens transparently with mutex
- **Socket Mode**: No public URL required - connects via WebSocket
- **Health Check Endpoint**: `/health` on port 3001 for container orchestration
- **Docker Support**: Containerized deployment with docker-compose and health checks

## File Structure

```
mcp-slackbot/
├── app.js                              # Main Bolt application (~2,170 lines)
├── db.js                               # LibSQL database operations
├── logger.js                           # Pino structured logging + sensitive-data sanitizer
├── sentry-init.js                      # Sentry SDK init (no-op when SENTRY_DSN unset)
├── package.json                        # Dependencies, scripts, packageManager pin
├── pnpm-lock.yaml                      # pnpm lockfile
├── pnpm-workspace.yaml                 # pnpm settings (allowed build scripts)
├── eslint.config.mjs                   # ESLint configuration
├── Dockerfile                          # Container configuration
├── docker-compose.yml                  # Docker orchestration with health checks
├── docker-compose.debug.yml.example    # Debug compose template
├── .env.example                        # Environment template
├── tests/                              # Vitest test suite
│   ├── app.test.js                     # Main test suite
│   ├── api_params.test.js              # API param construction tests
│   ├── app_sentry_sanitization.test.js # Sentry beforeSend scrubbing tests
│   ├── channel_assessment.test.js      # Channel broadcast block tests
│   ├── channel_broadcast_respond.test.js # Channel respond() tests
│   ├── logger_sanitizer.test.js        # Logger redaction tests
│   ├── runtime.test.js                 # Runtime/env sanity tests
│   ├── sentry_init.test.js             # sentry-init.js init/no-op tests
│   ├── token_refresh.test.js           # Token refresh + mutex tests
│   ├── helpers/                        # Shared test helpers
│   ├── fixtures/
│   │   ├── carrier-response.json       # Low-risk carrier test data (150 pts)
│   │   └── carrier-high-risk.json      # High-risk carrier test data (3500 pts)
│   ├── test_preview.js                 # Preview functionality script
│   ├── test_refresh.js                 # Token refresh script
│   └── test_token.js                   # Bearer token validation script
├── roadmap/                            # Project roadmap
├── postman/                            # Postman API collections
├── .github/
│   └── workflows/                      # CI/CD pipelines
├── .vscode/                            # VS Code debug configs
├── README.md                           # User documentation
├── CLAUDE.md                           # This file (AI context)
└── AGENTS.md                           # Symlinked to CLAUDE.md
```

## Environment Variables

### Required Variables

- `BEARER_TOKEN`: MyCarrierPortal API bearer token
- `REFRESH_TOKEN`: Token for refreshing expired bearer tokens
- `TOKEN_ENDPOINT_URL`: OAuth2 token endpoint (e.g., `https://api.mycarrierpackets.com/token`)
- `CLIENT_ID`: OAuth2 client ID for token refresh
- `CLIENT_SECRET`: OAuth2 client secret for token refresh
- `SLACK_BOT_TOKEN`: Slack bot OAuth token (xoxb-\*)
- `SLACK_SIGNING_SECRET`: Slack app signing secret
- `SLACK_APP_TOKEN`: Slack app-level token for Socket Mode (xapp-\*)

### Optional Variables

- `LIBSQL_URL`: LibSQL database URL for token persistence (default: `http://localhost:8081`)
- `LOG_LEVEL`: Pino log level (default: `info`)
- `SENTRY_DSN`: Sentry DSN. **Leave empty to disable error monitoring** — the app no-ops Sentry calls and logs a warning at startup.
- `SENTRY_ENVIRONMENT`: Sentry environment tag (default: `NODE_ENV`, then `production`)
- `SENTRY_RELEASE`: Release identifier (default: `mcp-slackbot@<package.json version>`)
- `SENTRY_TRACES_SAMPLE_RATE`: Trace sample rate `0..1` (default: `1.0`; values outside the range are clamped)

## Application Structure (app.js)

### Utility Functions

- `getRiskLevelEmoji(points)` / `getRiskLevel(points)` - Risk classification (Low/Medium/Review Required/Fail)
- `normalizeNullableText()` - Sanitizes null/undefined/empty values
- `formatSlackLinks()` - Converts HTML links to Slack markdown
- `formatInfractionLine()` - Formats infraction entries with points
- `chunkLines()` - Paginates content by line count and character limit

### State Management

- `wizardState` - In-memory `Map` storing wizard session data by wizardId (not persistent across restarts)
- `activeAssessments` - Tracks concurrent assessments per channel
- Helper functions: `hasActiveAssessment()`, `setActiveAssessment()`, `clearActiveAssessment()`

### API Functions

- `apiCall()` - Axios wrapper with automatic token refresh on 401
- `fetchCarrierData(mcNumber)` - GET `/carriers/search`
- `fetchCarrierIncidentReports()` - GET `/carriers/incidents`
- `fetchCarrierVINVerifications()` - GET `/carriers/vin-verifications`
- `fetchCarrierContacts()` - GET `/carriers/contacts`
- `sendIntellivite()` - POST to invite carrier via email

### Modal View Builders

- `buildStep1View(wizardId, carrierData)` - Overview modal
- `buildStep2View(wizardId, carrierData)` - Incident reports modal
- `buildStep3View(wizardId, carrierData, page)` - VIN verifications modal
- `buildStep4View(wizardId, carrierData)` - Contact/invite modal
- `buildSessionExpiredView()` - Session timeout error modal
- `buildChannelAssessmentBlocks()` - Channel broadcast message blocks

### Slack Handlers

- **Command**: `/risk` - Initiates wizard, fetches carrier data, opens Step 1 modal
- **Actions**: `wizard_next`, `wizard_back`, `wizard_vins_next`, `wizard_vins_prev`, `wizard_decline`, `select_contact`, `wizard_send_intellivite`
- **View submissions**: `carrier_wizard`, `carrier_wizard_step4`
- **View closed**: Cleanup handlers for wizard state and active assessments

## Development Guidelines

### Code Style

- Use `const` for immutable variables
- Descriptive error messages with structured logging (Pino)
- Async/await for asynchronous operations
- Bolt SDK patterns for Slack interactions (`ack()`, `respond()`, `client.views.open/push/update`)
- Helper functions for error-prone operations (`safeRespond()`)

### Security Considerations

- Never commit `.env` files or credentials
- Slack signature verification handled by Bolt SDK
- Sanitize user inputs from Slack commands
- Rotate tokens regularly
- Database failures are logged but don't crash the app

### Testing

The project uses **Vitest** as its test runner (migrated from Bun's test runner). Run with pnpm:

```bash
pnpm test                    # Run full Vitest suite (tests/**/*.test.js)
pnpm test:watch              # Vitest watch mode
pnpm test:api-params         # Single suite: API param construction
pnpm test:token              # Standalone bearer token script
pnpm test:refresh            # Standalone token refresh script
pnpm lint                    # Run ESLint
pnpm lint:fix                # Auto-fix lint issues
```

Use `pnpm` for **all** scripts — Bun is no longer supported and `bun test` will not discover the suite.

### Deployment

```bash
# Docker Compose (recommended)
docker compose up -d

# Node.js direct
pnpm install --frozen-lockfile
pnpm start

# Development (auto-restart via node --watch)
pnpm dev

# PM2 process manager (uses node interpreter)
pnpm pm2:start
pnpm pm2:logs
```

## API Integration

### MyCarrierPortal API

- **Base URL**: Configured as `CARRIER_API_URL` constant in app.js
- **Authentication**: Bearer token in Authorization header
- **Token Refresh**: POST to TOKEN_ENDPOINT_URL with refresh_token grant type, CLIENT_ID, and CLIENT_SECRET
- **Rate Limiting**: Consider API limits when handling requests

### Token Refresh Flow

1. API call returns 401 Unauthorized
2. Mutex ensures only one refresh runs at a time
3. Refresh token request to TOKEN_ENDPOINT_URL
4. Update BEARER_TOKEN and REFRESH_TOKEN (if new one provided)
5. Persist tokens to LibSQL database
6. Retry original API call with new token
7. Return result to Slack user

## Slack Command Format

```
/risk [DOT_NUMBER]
```

**Example**: `/risk 12345`

Opens a 4-step wizard modal for the requesting user and broadcasts a risk assessment summary to the channel.

## Common Development Tasks

### Adding New Slack Commands

1. Register command in Slack App configuration
2. Add `app.command('/newcommand', async ({ command, ack, respond }) => {...})` handler
3. Call `await ack()` immediately
4. Implement business logic
5. Use `safeRespond()` for error-safe responses
6. Update documentation

### Adding New Wizard Steps

1. Create `buildStepNView(wizardId, carrierData)` function
2. Add navigation logic in `wizard_next` / `wizard_back` action handlers
3. Use `client.views.push()` or `client.views.update()` as appropriate
4. Add cleanup logic in `view_closed` handlers
5. Write tests in `tests/app.test.js`

### Modifying API Calls

1. Locate API call in [app.js](app.js)
2. Update endpoint/parameters (use `CARRIER_API_URL` constant)
3. Handle new response structure
4. Update error handling
5. Test with `pnpm test`

### Debugging

- Check container logs: `docker compose logs -f mcpslackbot`
- Monitor token refresh: `docker logs -f mcpslackbot | grep -i refresh`
- Health check: `curl http://localhost:3001/health` (reports `sentry: ok | unconfigured` alongside db status)
- Inspect Sentry events: your Sentry project dashboard (see `SENTRY_DSN` in `.env`)
- Sentry disabled locally? Leave `SENTRY_DSN` empty in `.env` — the app logs a warning and continues without it.

## Troubleshooting

### Token Issues

- **401 errors**: Check BEARER_TOKEN validity
- **Refresh fails**: Verify REFRESH_TOKEN, CLIENT_ID, CLIENT_SECRET, and TOKEN_ENDPOINT_URL
- **Token not persisting**: Check LibSQL connectivity in health endpoint
- **Race conditions**: Token refresh mutex should handle concurrent requests

### Slack Integration

- **Command not responding**: Verify SLACK_APP_TOKEN and Socket Mode is enabled
- **Connection drops**: Check SLACK_APP_TOKEN hasn't expired
- **No Socket Mode**: Ensure app is configured for Socket Mode in Slack API settings
- **Modal not opening**: Check `client.views.open()` response for errors

### Docker Deployment

- **Container won't start**: Check `docker compose logs`
- **Health check failing**: Verify port 3001 is exposed
- **Environment variables not loading**: Verify `.env` file location and formatting

### Sentry / Error Monitoring

- **No events in Sentry**: Confirm `SENTRY_DSN` is set in the container env (`docker compose exec mcpslackbot env | grep SENTRY`) and that `/health` reports `sentry: ok`
- **Sensitive data appearing in events**: Check the sanitizer in `logger.js` and the `beforeSend` hook; add coverage in `tests/app_sentry_sanitization.test.js`
- **Want local dev without Sentry**: Leave `SENTRY_DSN` blank — the SDK no-ops and only a single startup warning is logged

## Development Workflow

1. Create feature branch from `main`
2. Implement changes with tests
3. Run `pnpm test` to validate
4. Run `pnpm lint` to check code style
5. Update documentation if needed
6. Create pull request to `main`
7. GitHub Actions runs automated tests
8. Review and merge

## Contact & Support

**Maintainer**: freightCognition
**Issues**: https://github.com/freightcognition/risk-slackbot/issues
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
- Wizard state is in-memory only - be aware of restart implications
- Modal views use Slack Block Kit - respect 75-char limits for option labels/values
- Test commands in Docker before suggesting deployment
- Health endpoint available at `http://localhost:3001/health`
- **Always use `pnpm`, never `bun` or `npm`** — `pnpm` is pinned via `packageManager` and CI/Docker assume it
- Tests run under **Vitest** (`pnpm test`). When adding tests, use `vitest`'s `describe`/`it`/`expect` API and place files under `tests/*.test.js`
- When adding code paths that throw, ensure errors flow through `Sentry.captureException` with appropriate `tags` (see existing `source: "slack-bolt"` pattern) and that any user/secret data is scrubbed first
