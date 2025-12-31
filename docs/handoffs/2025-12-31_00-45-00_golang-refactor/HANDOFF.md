---
date: 2025-12-31T06:45:00+00:00
researcher: Claude
git_commit: 74c2c86cdb405d797cdb0382eefdb70c0730b97c
branch: hotfix/refresh-token-fix
repository: mcp-slackbot
topic: "Golang Refactor Implementation Strategy"
tags: [implementation, strategy, golang, slack-bolt, socket-mode, refactor]
status: in_progress
last_updated: 2025-12-31
last_updated_by: Claude
type: implementation_strategy
---

# Handoff: Golang Refactor of MCP Slackbot

## Task(s)

| Task | Status |
|------|--------|
| Fix refresh token (remove client_id/client_secret from refresh request) | Completed |
| Add libSQL token persistence | Completed |
| Fix docker compose v2 syntax | Completed |
| Change libSQL port from 8080 to 8081 | Completed |
| Update all documentation | Completed |
| **Refactor entire codebase to Golang** | Planned |

## Critical References

- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/app.js` - Current Node.js implementation (main application logic)
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/db.js` - libSQL database module
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/thoughts/shared/research/2025-12-30-refresh-token-functionality.md` - Root cause analysis of token refresh

## Recent Changes

- `app.js:204-207` - Fixed refresh token request (removed client_id/client_secret)
- `db.js:1-46` - New libSQL persistence module
- `docker-compose.yml:1-36` - Added libSQL service on port 8081
- `.github/workflows/deploy.yml:50,74,82-110` - Fixed docker compose v2 syntax

## Learnings

1. **MyCarrierPortal API Token Refresh**: Only requires `grant_type=refresh_token` and `refresh_token` parameters. Do NOT send `client_id`/`client_secret` (those are username/password for initial password grant only).

2. **Token Rotation**: MCP rotates refresh tokens on each refresh. The new refresh_token in the response replaces the old one. Must persist both tokens after each refresh.

3. **Slack 3-Second Timeout**: Current HTTP webhook approach has a 3-second response deadline. Socket Mode eliminates this constraint.

4. **Port Conflicts**: Port 8080 was in use by dockerd on the self-hosted runner. Using 8081 for libSQL.

5. **Docker Compose v2**: Use `docker compose` (space) not `docker-compose` (hyphen) on modern systems.

## Artifacts

Files produced/updated in this session:
- `app.js` - Token refresh fix
- `db.js` - New file for libSQL persistence
- `docker-compose.yml` - Added libSQL service
- `.github/workflows/deploy.yml` - Fixed docker compose syntax
- `README.md` - Updated documentation
- `thoughts/shared/research/2025-12-30-refresh-token-functionality.md`
- `thoughts/shared/plans/2025-12-30-libsql-token-persistence.md`

## Action Items & Next Steps

### Golang Refactor - Step-by-Step Plan

#### Phase 1: Project Setup

1. **Initialize Go module**:
   ```bash
   mkdir cmd pkg internal
   go mod init github.com/freightcognition/mcp-slackbot
   ```

2. **Add dependencies**:
   ```bash
   go get github.com/slack-go/slack
   go get github.com/tursodatabase/libsql-client-go/libsql
   go get github.com/joho/godotenv
   ```

3. **Project structure**:
   ```
   mcp-slackbot/
   ├── cmd/
   │   └── slackbot/
   │       └── main.go           # Entry point
   ├── internal/
   │   ├── config/
   │   │   └── config.go         # Environment config
   │   ├── db/
   │   │   └── tokens.go         # libSQL token persistence
   │   ├── mcp/
   │   │   └── client.go         # MyCarrierPortal API client
   │   └── slack/
   │       └── handler.go        # Slack command handlers
   ├── pkg/
   │   └── oauth/
   │       └── refresh.go        # OAuth token refresh logic
   ├── Dockerfile
   ├── docker-compose.yml
   └── go.mod
   ```

#### Phase 2: Core Components

1. **Config (`internal/config/config.go`)**:
   - Load from environment variables
   - Required: BEARER_TOKEN, REFRESH_TOKEN, TOKEN_ENDPOINT_URL, CLIENT_ID, CLIENT_SECRET, SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET
   - Optional: LIBSQL_URL (default: http://libsql:8081), PORT (default: 3001)

2. **Database (`internal/db/tokens.go`)**:
   - Connect to libSQL at LIBSQL_URL
   - `InitDB()` - Create tokens table if not exists
   - `GetTokens() (bearerToken, refreshToken string, err error)`
   - `SaveTokens(bearerToken, refreshToken string) error`
   - Same schema as current:
     ```sql
     CREATE TABLE IF NOT EXISTS tokens (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       bearer_token TEXT NOT NULL,
       refresh_token TEXT NOT NULL,
       updated_at TEXT DEFAULT (datetime('now'))
     )
     ```

3. **OAuth Refresh (`pkg/oauth/refresh.go`)**:
   - `RefreshAccessToken(refreshToken, tokenEndpoint string) (newBearer, newRefresh string, err error)`
   - POST to TOKEN_ENDPOINT_URL with ONLY:
     ```
     grant_type=refresh_token
     refresh_token=<token>
     ```
   - Parse response for access_token and refresh_token
   - Return both (refresh_token may be new or same)

4. **MCP Client (`internal/mcp/client.go`)**:
   - `type Client struct { bearerToken string, tokenEndpoint string, ... }`
   - `GetCarrierAssessment(mcNumber string) (*Assessment, error)`
   - Auto-refresh on 401: call RefreshAccessToken, update token, retry once
   - Save new tokens to database after refresh

5. **Slack Handler (`internal/slack/handler.go`)**:
   - Use `github.com/slack-go/slack` with Socket Mode
   - Register `/mcp` command handler
   - Parse MC number from command text
   - Call MCP client
   - Format response with Block Kit (same blocks as current app.js)
   - Return via `respond()`

#### Phase 3: Socket Mode Implementation

```go
package main

import (
    "github.com/slack-go/slack"
    "github.com/slack-go/slack/socketmode"
)

func main() {
    api := slack.New(
        os.Getenv("SLACK_BOT_TOKEN"),
        slack.OptionAppLevelToken(os.Getenv("SLACK_APP_TOKEN")),
    )

    client := socketmode.New(api)

    go func() {
        for evt := range client.Events {
            switch evt.Type {
            case socketmode.EventTypeSlashCommand:
                cmd, _ := evt.Data.(slack.SlashCommand)
                if cmd.Command == "/mcp" {
                    client.Ack(*evt.Request)
                    // Handle command asynchronously
                    go handleMCPCommand(api, cmd)
                }
            }
        }
    }()

    client.Run()
}
```

#### Phase 4: Slack App Configuration

1. Go to https://api.slack.com/apps and select your app
2. Enable **Socket Mode** in Settings > Socket Mode
3. Generate **App-Level Token** with `connections:write` scope
4. Add token as `SLACK_APP_TOKEN` (starts with `xapp-`)
5. Slash command `/mcp` stays registered, but Request URL becomes optional

#### Phase 5: Docker Updates

1. **Update Dockerfile** for Go:
   ```dockerfile
   FROM golang:1.21-alpine AS builder
   WORKDIR /app
   COPY go.mod go.sum ./
   RUN go mod download
   COPY . .
   RUN CGO_ENABLED=0 go build -o /slackbot ./cmd/slackbot

   FROM alpine:latest
   RUN apk --no-cache add ca-certificates
   COPY --from=builder /slackbot /slackbot
   CMD ["/slackbot"]
   ```

2. **Update docker-compose.yml**:
   - Add `SLACK_APP_TOKEN` environment variable
   - Keep libSQL service unchanged
   - Update build context if needed

3. **Update deploy.yml**:
   - Add `SLACK_APP_TOKEN` secret
   - No other changes needed (docker compose commands stay same)

#### Phase 6: Testing

1. **Unit tests**:
   - `pkg/oauth/refresh_test.go` - Test token refresh parsing
   - `internal/db/tokens_test.go` - Test database operations
   - `internal/mcp/client_test.go` - Test API client with mocked responses

2. **Integration test**:
   - Start libSQL container
   - Run refresh token test against real MCP API
   - Verify tokens saved to database

#### Phase 7: Migration Checklist

- [ ] Go module initialized
- [ ] Config loading from env vars
- [ ] libSQL connection working
- [ ] Token refresh working (grant_type + refresh_token only!)
- [ ] MCP API client with auto-refresh on 401
- [ ] Slack Socket Mode connected
- [ ] /mcp command responding
- [ ] Block Kit formatting matches current output
- [ ] Dockerfile builds successfully
- [ ] docker-compose.yml updated
- [ ] GitHub Actions workflow updated
- [ ] SLACK_APP_TOKEN secret added
- [ ] Old Node.js files removed

## Other Notes

### Current Response Format (Block Kit)

The current app.js builds Slack blocks like this (preserve this format):
- Header block with "Carrier Risk Assessment"
- Section with MC number, DOT number
- Section with risk score, authority status
- Divider
- Additional sections for insurance, safety rating, etc.

Reference `app.js:278-400` for exact block structure.

### Environment Variables Needed

```env
# Existing
BEARER_TOKEN=<from database or initial seed>
REFRESH_TOKEN=<from database or initial seed>
TOKEN_ENDPOINT_URL=https://api.mycarrierpackets.com/token
CLIENT_ID=<MCP username - only for password grant, not used in refresh>
CLIENT_SECRET=<MCP password - only for password grant, not used in refresh>
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=<keep for any HTTP endpoints>

# New for Socket Mode
SLACK_APP_TOKEN=xapp-...

# Database
LIBSQL_URL=http://libsql:8081
```

### Key Behavioral Requirements

1. **On startup**: Load tokens from database (fallback to env if empty)
2. **On 401 from MCP API**: Refresh token, save both new tokens, retry request
3. **On token refresh**: Always save both bearer AND refresh token (MCP rotates them)
4. **On /mcp command**: Acknowledge immediately, then process async

### Useful Libraries

- `github.com/slack-go/slack` - Official Slack SDK with Socket Mode support
- `github.com/tursodatabase/libsql-client-go/libsql` - libSQL client for Go
- `github.com/joho/godotenv` - Load .env files (for local dev)

### Discussion Points with User

Before implementing, consider asking:
1. Should we keep a health endpoint? (Useful for load balancers/monitoring)
2. Any additional slash commands to add while refactoring?
3. Preference for logging library? (logrus, zap, slog)
4. Should we add metrics/observability? (prometheus, opentelemetry)
