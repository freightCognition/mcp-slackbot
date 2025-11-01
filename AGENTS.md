# AI Agents and Automated Systems in MCP-Slackbot

This document outlines the AI agents and automated systems implemented in the `mcp-slackbot` repository.

## Token Refresh Agent/Mechanism

**File:** `app.js`
**Function:** `refreshAccessToken()`

The `mcp-slackbot` includes a reactive token refresh mechanism to handle the expiration of OAuth 2.0 access tokens required for MyCarrierPortal API authentication.

### Implementation Details

- **Trigger:** The token refresh process is triggered automatically when an API request fails with a `401 Unauthorized` status code.
- **Functionality:** The `refreshAccessToken()` function sends a `POST` request to the MyCarrierPortal API's token endpoint with the `refresh_token`.
- **Token Storage:** Upon successful refresh, the new `access_token` (and `refresh_token`, if provided) are updated in the application's environment variables and stored in the `.env` file.

## API Request Handler

**File:** `app.js`

The API request handler includes a retry mechanism that integrates with the token refresh agent.

### Implementation Details

- **Error Detection:** When an API call to the MyCarrierPortal API returns a `401 Unauthorized` error, the handler initiates the token refresh process.
- **Retry Logic:** After a successful token refresh, the original API request is automatically retried.
- **Failure:** If the token refresh fails or the retried API request also fails, the system will return an error message to the user.

## Known Issues

- **Reactive Refresh Only:** The current implementation only refreshes tokens reactively (after a `401` error) rather than proactively.
- **Refresh Token Expiration:** The refresh token expires every 15 days, even with daily usage.
- **No Expiry Tracking:** The system does not track token expiry dates, which can lead to failures if the bot is not used for an extended period.

## Future Improvements

- **Proactive Token Refresh:** Implement a proactive token refresh mechanism to regularly refresh tokens before they expire. This could be achieved using a scheduled job that runs periodically.
- **Token Expiry Tracking:** Add functionality to track the expiry dates of both access and refresh tokens to enable more intelligent refresh logic.
