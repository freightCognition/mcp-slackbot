# Refactor JavaScript Slack Bot to Golang with Socket Mode and Create Unit Tests

## Overview 

Refactor the existing JavaScript Slack bot in the `freightCognition/mcp-slackbot` repository to Golang using the `slack-go` socketmode package ([https://pkg.go.dev/github.com/slack-go/slack/socketmode](https://pkg.go.dev/github.com/slack-go/slack/socketmode)). This involves converting the current HTTP-based Express server implementation to a WebSocket-based Socket Mode implementation, porting all business logic, and creating comprehensive unit tests.

## Current Architecture (JavaScript) 

The current implementation in `app.js` includes:

- An Express HTTP server listening on port 3000 (lines 10-11)
- A `/slack/commands` POST endpoint for slash commands
- Signature verification middleware (lines 93-121)
- Token refresh mechanism that updates the `.env` file (lines 123-141 and 143-187)
- Main slash command handler for `/mcp` command (lines 189-385)
- Helper functions for risk assessment:
    - `getRiskLevelEmoji()` (lines 58-68)
    - `getRiskLevel()` (lines 70-80)
    - `formatInfractions()` (lines 82-90)
- Health check endpoint at `/health` (lines 387-390)

Environment variables currently used (lines 13-18):

- `SLACK_WEBHOOK_URL`
- `BEARER_TOKEN`
- `REFRESH_TOKEN`
- `TOKEN_ENDPOINT_URL`

Startup validation checks these tokens (lines 21-42).

## Required Go Project Structure 

Create the following directory structure:

```
main.go                 // Entry point, Socket Mode setup  
handlers/  
  ├── slash.go         // Slash command handler  
  └── events.go        // Event handlers (if needed)  
services/  
  ├── mcp_api.go       // MyCarrierPortal API client  
  └── token_manager.go // Token refresh logic  
formatters/  
  └── slack.go         // Slack message formatting  
config/  
  └── config.go        // Environment variable loading  
```

## Environment Variables Changes 

**Remove:**

- `SLACK_WEBHOOK_URL` (Socket Mode uses the API directly)

**Add:**

- `SLACK_APP_TOKEN` (starts with `xapp-`, required for Socket Mode)
- `SLACK_BOT_TOKEN` (required for Socket Mode)

**Keep:**

- `BEARER_TOKEN`
- `REFRESH_TOKEN`
- `TOKEN_ENDPOINT_URL`

## Core Logic to Port 

### 1. Main Entry Point (`main.go`) 

Implement Socket Mode setup following this pattern:

```
package main    import (      "github.com/slack-go/slack"      "github.com/slack-go/slack/socketmode"  )    func main() {      // Initialize Slack API client      api := slack.New(          botToken,          slack.OptionDebug(true),          slack.OptionAppLevelToken(appToken),      )            // Create socketmode client      client := socketmode.New(          api,          socketmode.OptionDebug(true),      )            // Handle slash commands      go func() {          for evt := range client.Events {              switch evt.Type {              case socketmode.EventTypeSlashCommand:                  cmd, ok := evt.Data.(slack.SlashCommand)                  if ok && cmd.Command == "/mcp" {                      // Acknowledge immediately (within 3 seconds)                      client.Ack(*evt.Request)                                            // Process in goroutine                      go handleMCPCommand(api, cmd)                  }              }          }      }()            client.Run()  }
```

Also run a separate HTTP server for health checks on port 3001:

```
go func() {      http.HandleFunc("/health", healthCheckHandler)      http.ListenAndServe(":3001", nil)  }()
```

### 2. Token Refresh Mechanism (`services/token_manager.go`) 

Port the token refresh logic from `app.js` lines 143-187. Key requirements:

- Implement automatic token refresh when receiving 401 errors
- Update the `.env` file with new tokens (similar to lines 125-140 in current implementation)
- Use a `sync.Mutex` to protect concurrent token refreshes (thread-safe)
- Consider using `github.com/joho/godotenv` for .env file updates

### 3. Slash Command Handler (`handlers/slash.go`) 

Port the main slash command logic from `app.js` lines 189-385:

- Extract MC number from the command text (lines 190-196)
- Make API calls with retry on 401 (lines 200-384)
- Format response using Slack Block Kit (lines 224-338)
- Send immediate acknowledgment using `client.Ack(*evt.Request)`
- Send detailed response using `api.PostMessage()` or `api.PostEphemeral()` (NOT webhooks like the current implementation at lines 342-361)

### 4. Risk Assessment Functions (`formatters/slack.go`) 

Port these helper functions from `app.js`:

- `getRiskLevelEmoji()` from lines 58-68
- `getRiskLevel()` from lines 70-80
- `formatInfractions()` from lines 82-90

### 5. MyCarrierPortal API Client (`services/mcp_api.go`) 

Port the API call logic from `app.js` lines 203-214:

- Use Go's `net/http` standard library
- Create a custom HTTP client with timeout
- Implement automatic token refresh with retries (similar to the pattern at lines 364-383)
- Define Go structs for the MyCarrierPortal API responses

### 6. Configuration Loading (`config/config.go`) 

Implement environment variable loading with validation similar to the startup checks in `app.js` lines 21-42.

## Key Architectural Differences 

1. **No HTTP Server for Slack Requests**: Socket Mode uses WebSockets with outbound connections, eliminating the need for a public URL and signature verification middleware (which currently exists at lines 93-121)
    
2. **Response Handling**: Instead of using webhooks (`SLACK_WEBHOOK_URL` and response_url as in lines 342-361), use the Slack Web API directly via `api.PostMessage()`
    
3. **Concurrency**: Implement thread-safe token refresh using `sync.Mutex` to avoid race conditions
    
4. **Retry Logic**: Maintain the retry pattern from the current implementation (lines 197-198 show a while loop for retries)
    

## Unit Tests 

Create comprehensive unit tests using Go's `testing` package. The current JavaScript implementation has test scripts defined in `package.json` lines 13-16 that will need to be rewritten.

Create test files:

- `handlers/slash_test.go`
- `services/mcp_api_test.go`
- `services/token_manager_test.go`
- `formatters/slack_test.go`
- `config/config_test.go`

Tests should cover:

- Token refresh logic with mock HTTP responses
- Slash command parsing and MC number extraction
- Risk level calculation with various input scenarios
- API client retry logic on 401 errors
- Slack message formatting
- Environment variable validation

## Dependencies 

Required Go packages:

- `github.com/slack-go/slack`
- `github.com/slack-go/slack/socketmode`
- `github.com/joho/godotenv` (for .env file handling)
- Standard library: `net/http`, `sync`, `testing`

## Deliverables 

1. Complete Go implementation following the structure above
2. All business logic ported from the JavaScript version
3. Unit tests for all major components
4. Updated README with Go-specific setup instructions
5. Working Socket Mode integration (no public URL required)