# MCP Slackbot

A Slack bot for executing Carrier Risk Assessments using the MyCarrierPortal API within your Slack environment.

*Brought to you by Anthony Fecarotta of freightCognition & linehaul.ai*

![MCP Slackbot Screenshot](./MCP-Slackbot-Screenshot.png)

## Prerequisites

- Docker and Docker Compose (Recommended)
- A Slack workspace with permissions to add apps
- MyCarrierPortal API access (including Bearer Token, Refresh Token, and Token Endpoint URL)
- Node.js >= 18.0.0 (if not using Docker)

## Architecture

This application uses a **dual-container architecture** with Docker Compose:

- **mcpslackbot**: Node.js application serving Slack commands and API integration
- **libsql**: Database server (Turso libSQL) for persistent token storage

Token persistence ensures OAuth refresh tokens survive container restarts and enables automatic token rotation without manual intervention.

## Quick Start with Docker Compose

### 1. Clone the repository

```bash
git clone https://github.com/freightcognition/mcp-slackbot.git
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

# Slack Configuration
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your_slack_signing_secret
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/webhook/url

# Application Configuration
NODE_ENV=production
PORT=3001

# Database Configuration (optional - defaults shown)
LIBSQL_URL=http://libsql:8080
```

**Important Notes:**
- `CLIENT_ID` and `CLIENT_SECRET` are your MyCarrierPortal **username and password** (used for initial token generation only)
- These credentials are NOT sent with refresh token requests
- Initial `BEARER_TOKEN` and `REFRESH_TOKEN` values are only used on first startup to seed the database

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

# Just the database
docker compose logs -f libsql
```

Look for these startup messages:
- `Database initialized`
- `Loaded tokens from database` OR `No tokens in database, saving from environment`
- `Server is running on port 3001`

### 5. Test token refresh functionality

```bash
docker compose exec mcpslackbot node tests/test_refresh.js
```

Expected output:
```
Starting token refresh test...
Loaded tokens from database
Current Bearer Token (first 20 chars): 2_HG7Zvg3wqYkqtXxKge...
Current Refresh Token: a2afa1653b4b4b048398...
Attempting to refresh access token...
Response received: { ... }
Access token refreshed successfully.
New refresh token received.
Tokens saved to database
Test successful!
```

### 6. Health check

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{"status":"healthy"}
```

## Token Persistence & Rotation

### How It Works

1. **First Startup**: Tokens from environment variables are saved to the libSQL database
2. **Subsequent Startups**: Tokens are loaded from the database (not environment variables)
3. **Token Refresh**: When access token expires (14 days), the app automatically:
   - Detects 401 error from MyCarrierPortal API
   - Calls refresh endpoint with current refresh token
   - Receives new access token and refresh token
   - Saves both to database
   - Retries the failed API call
4. **Container Restart**: Tokens persist in the libSQL volume and are automatically loaded

### Database Management

**View current tokens:**
```bash
docker compose exec mcpslackbot node -e "
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: 'http://libsql:8080' });
  db.execute('SELECT bearer_token, refresh_token, updated_at FROM tokens').then(r => console.log(r.rows));
"
```

**Manually update tokens in database:**
```bash
docker compose exec mcpslackbot node -e "
  const { saveTokens } = require('./db');
  saveTokens('new_bearer_token', 'new_refresh_token').then(() => console.log('Done'));
"
```

**Backup database:**
```bash
# Stop containers first
docker compose down

# Copy the volume data
docker run --rm -v mcp-slackbot_libsql-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/libsql-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restart containers
docker compose up -d
```

**Restore database:**
```bash
docker compose down
docker run --rm -v mcp-slackbot_libsql-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/libsql-backup-YYYYMMDD.tar.gz -C /data
docker compose up -d
```

## Deployment with GitHub Actions

This repository includes a self-hosted GitHub Actions workflow for automatic deployment.

### Setup Self-Hosted Runner

1. Install GitHub Actions runner on your server (Proxmox VM, etc.)
2. Configure the runner for your repository
3. Add required secrets to your GitHub repository

### Required GitHub Secrets

Navigate to **Settings > Secrets and variables > Actions** and add:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `BEARER_TOKEN` | Initial MyCarrierPortal access token | `VyTeZfFdtMagZ03J...` |
| `REFRESH_TOKEN` | Initial MyCarrierPortal refresh token | `a2afa1653b4b4b04...` |
| `TOKEN_ENDPOINT_URL` | MyCarrierPortal token endpoint | `https://api.mycarrierpackets.com/token` |
| `CLIENT_ID` | MyCarrierPortal username | `your_username` |
| `CLIENT_SECRET` | MyCarrierPortal password | `your_password` |
| `SLACK_SIGNING_SECRET` | Slack app signing secret | `1234567890abcdef...` |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL | `https://hooks.slack.com/...` |

**Note:** After the first deployment, tokens will be managed automatically via the database. GitHub Secrets only provide initial values.

### Deployment Workflow

The workflow triggers on:
- Push to `main` branch
- Manual trigger via GitHub Actions UI (can deploy any branch)

**Deployment steps:**
1. Checkout code from specified branch
2. Stop existing containers
3. Create `.env` file from GitHub Secrets
4. Start containers with `docker compose up -d --build`
5. Wait for containers to start (15 seconds)
6. Verify health endpoint responds
7. Test refresh token functionality
8. Clean up `.env` file (for security)

**View deployment logs:**
- Go to **Actions** tab in GitHub
- Click on the latest workflow run
- Expand each step to see detailed logs

**Manual deployment:**
1. Go to **Actions** tab
2. Select **Deploy to Production** workflow
3. Click **Run workflow**
4. Enter branch name (or leave as `main`)
5. Click **Run workflow** button

## Updating Tokens

### Scenario 1: First-Time Setup

If you're starting fresh or need to reset tokens:

1. Obtain fresh tokens from MyCarrierPortal using password grant:
   ```bash
   curl -X POST https://api.mycarrierpackets.com/token \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=password&username=YOUR_USERNAME&password=YOUR_PASSWORD"
   ```

2. Update `.env` file with the response tokens:
   ```bash
   BEARER_TOKEN=<access_token from response>
   REFRESH_TOKEN=<refresh_token from response>
   ```

3. Restart containers:
   ```bash
   docker compose down
   docker compose up -d
   ```

### Scenario 2: Rotating Tokens in Production

Tokens are automatically rotated! You don't need to manually update them.

If you ever need to force a refresh:
```bash
docker compose exec mcpslackbot node tests/test_refresh.js
```

### Scenario 3: Token Corruption or Loss

If the database becomes corrupted:

1. Get fresh tokens (see Scenario 1)
2. Stop containers:
   ```bash
   docker compose down
   ```
3. Remove the volume:
   ```bash
   docker volume rm mcp-slackbot_libsql-data
   ```
4. Update `.env` with fresh tokens
5. Start containers:
   ```bash
   docker compose up -d
   ```

The database will be recreated and seeded with the new tokens.

## Alternative Deployment Methods (Without Docker)

If you prefer not to use Docker, you can run the application directly with Node.js. **Note:** You'll need to run your own libSQL server or modify the code to use a different database.

### Prerequisites for Direct Deployment
- Node.js >= 18.0.0
- npm (Node Package Manager)
- libSQL server running (or modify code for different database)

### Setup and Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Create a `.env` file with all required variables (see section 2 above)

3. **Run libSQL server separately:**
   ```bash
   # Download and run sqld
   # See: https://github.com/tursodatabase/libsql
   ```

4. **Run the application:**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start

   # Or with PM2
   npm run pm2:start
   npm run pm2:logs
   npm run pm2:stop
   ```

## Slack App Configuration

To use this bot, you need to create a Slack App:

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click "Create New App"
2. Choose "From scratch"
3. Name your app (e.g., "MCP Bot") and select your workspace

### Slash Commands

1. Navigate to **Features > Slash Commands**
2. Click **Create New Command**
3. Configure:
   - **Command:** `/mcp`
   - **Request URL:** `https://your-public-url.com/slack/commands`
   - **Short Description:** "Fetch MCP Carrier Risk Assessment"
   - **Usage Hint:** `[MC number]`
4. Save

**For local development:** Use ngrok to create a public URL:
```bash
ngrok http 3001
# Use the https URL provided by ngrok
```

### Permissions (OAuth & Permissions)

1. Navigate to **Features > OAuth & Permissions**
2. Add **Bot Token Scopes**:
   - `commands` - Required for slash commands
   - `chat:write` - Required to send messages
3. Click **Install to Workspace**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) to use as `SLACK_BOT_TOKEN`

### App Credentials

1. Navigate to **Settings > Basic Information**
2. Find **Signing Secret** under "App Credentials"
3. Copy to use as `SLACK_SIGNING_SECRET`

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BEARER_TOKEN` | Yes | MyCarrierPortal access token | `VyTeZfFdtMagZ03J...` |
| `REFRESH_TOKEN` | Yes | MyCarrierPortal refresh token | `a2afa1653b4b4b04...` |
| `TOKEN_ENDPOINT_URL` | Yes | Token refresh endpoint | `https://api.mycarrierpackets.com/token` |
| `CLIENT_ID` | Yes | MyCarrierPortal username | `your_username` |
| `CLIENT_SECRET` | Yes | MyCarrierPortal password | `your_password` |
| `SLACK_SIGNING_SECRET` | Yes | Slack app signing secret | `1234567890abcdef...` |
| `SLACK_WEBHOOK_URL` | Yes | Slack incoming webhook URL | `https://hooks.slack.com/...` |
| `SLACK_BOT_TOKEN` | No* | Slack bot token | `xoxb-...` |
| `NODE_ENV` | No | Environment mode | `production` or `development` |
| `PORT` | No | Application port | `3001` (default) |
| `LIBSQL_URL` | No | Database connection URL | `http://libsql:8080` (default) |
| `TEST_API_KEY` | No | API key for test endpoints | `secure_random_string` |

*Currently configured but not actively used by the application

## Testing

The project includes comprehensive test scripts for verifying functionality.

### Available Test Scripts

```bash
# Run all tests
npm test

# Test bearer token against API
npm run test:token

# Test refresh token functionality
npm run test:refresh
```

### Testing Refresh Token with Docker Compose

**Quick test:**
```bash
docker compose exec mcpslackbot node tests/test_refresh.js
```

**Expected success output:**
```
Starting token refresh test...
Loaded tokens from database
Current Bearer Token (first 20 chars): 2_HG7Zvg3wqYkqtXxKge...
Current Refresh Token: a2afa1653b4b4b048398...
Attempting to refresh access token...
Response received: {
  "access_token": "tTG1sIov5mITHION...",
  "token_type": "bearer",
  "expires_in": 1209599,
  "refresh_token": "bc306b1405554e03...",
  "userName": "...",
  ".issued": "Wed, 31 Dec 2025 04:32:53 GMT",
  ".expires": "Wed, 14 Jan 2026 04:32:53 GMT"
}
Access token refreshed successfully.
New refresh token received.
Tokens saved to database
Test successful!
New Bearer Token (first 20 chars): tTG1sIov5mITHIONeI1_...
New Refresh Token: bc306b1405554e038b82...
```

### Testing After Container Restart

Verify tokens persist across restarts:

```bash
# Restart the app container (database stays running)
docker compose restart mcpslackbot

# Wait for startup
sleep 5

# Check logs - should show "Loaded tokens from database"
docker compose logs mcpslackbot | grep -i token

# Verify tokens still work
docker compose exec mcpslackbot node tests/test_refresh.js
```

### Real-World Scenario Testing

Test automatic token refresh when access token expires:

1. Use an old/expired `BEARER_TOKEN`
2. Trigger a Slack command: `/mcp MC123456`
3. Watch logs for automatic refresh:
   ```bash
   docker compose logs -f mcpslackbot
   ```

Expected log sequence:
```
Fetching data for MC number: mc123456, attempt 1
Access token expired or invalid. Attempting refresh...
Attempting to refresh access token...
Access token refreshed successfully.
New refresh token received.
Tokens saved to database
Token refreshed. Retrying API call...
Fetching data for MC number: mc123456, attempt 2
Data received for MC number: mc123456
Sending Slack response for MC number: mc123456
```

### Monitoring Token Activity

```bash
# Watch for refresh activity
docker compose logs -f mcpslackbot | grep -i -E "(refresh|token|401)"

# Check database last update time
docker compose exec mcpslackbot node -e "
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: 'http://libsql:8080' });
  db.execute('SELECT updated_at FROM tokens WHERE id = 1').then(r => console.log('Last updated:', r.rows[0]?.updated_at));
"
```

### Success Indicators

✅ **Everything working correctly:**
- Database initializes on startup
- Tokens loaded from database (not environment)
- Health endpoint responds
- Refresh test passes
- Slack commands work
- 401 errors trigger automatic refresh
- New tokens saved to database
- Container restarts preserve tokens

❌ **Potential issues:**
- `REFRESH_TOKEN not found in database or environment` - Need to seed database
- `Error refreshing access token: {"error": "invalid_grant"}` - Refresh token expired/invalid
- `Error loading tokens from database` - Database connection issue
- Tokens revert after restart - Volume not persisting correctly

## Troubleshooting

### Containers won't start

**Check logs:**
```bash
docker compose logs
```

**Common issues:**
- Port 3001 or 8080 already in use - change `PORT` in `.env`
- Missing environment variables - verify `.env` file exists and is complete
- Permission issues - ensure user can access Docker socket

### Database connection errors

**Verify libSQL is running:**
```bash
docker compose ps libsql
curl http://localhost:8080/health
```

**Check network:**
```bash
docker compose exec mcpslackbot ping -c 3 libsql
```

**Reset database:**
```bash
docker compose down
docker volume rm mcp-slackbot_libsql-data
docker compose up -d
```

### Tokens not persisting

**Check volume exists:**
```bash
docker volume ls | grep libsql
```

**Inspect volume:**
```bash
docker volume inspect mcp-slackbot_libsql-data
```

**Verify database has data:**
```bash
docker compose exec mcpslackbot node -e "
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: 'http://libsql:8080' });
  db.execute('SELECT COUNT(*) as count FROM tokens').then(r => console.log('Token count:', r.rows[0]?.count));
"
```

### Refresh token fails

**Get detailed error:**
```bash
docker compose exec mcpslackbot node tests/test_refresh.js
```

**Check token endpoint URL:**
```bash
docker compose exec mcpslackbot printenv TOKEN_ENDPOINT_URL
# Should be: https://api.mycarrierpackets.com/token
```

**Obtain fresh tokens:**
```bash
curl -X POST https://api.mycarrierpackets.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password&username=YOUR_USERNAME&password=YOUR_PASSWORD"
```

Then update tokens in database (see "Updating Tokens" section).

### Slack commands not working

**Verify Slack configuration:**
1. Request URL must be publicly accessible
2. Signing secret must match
3. Bot has required scopes

**Check signature verification:**
```bash
docker compose logs mcpslackbot | grep -i signature
```

**Test health endpoint externally:**
```bash
curl https://your-public-url.com/health
```

## Security Best Practices

- ✅ **Never commit `.env` files** - Already in `.gitignore`
- ✅ **Use Docker secrets in production** - Configured in `docker compose.yml`
- ✅ **Rotate credentials regularly** - Automatic for access/refresh tokens
- ✅ **Use HTTPS for public endpoints** - Required by Slack
- ✅ **Restrict test endpoints** - `/test/refresh` disabled in production
- ✅ **Backup database regularly** - Contains sensitive tokens
- ✅ **Use `.env.example`** - Never contains real credentials
- ✅ **Implement volume encryption** - Consider for libsql-data volume
- ✅ **Monitor access logs** - Track unusual activity

## Maintenance

### Updating the Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker compose down
docker compose up -d --build

# Verify
docker compose logs -f
```

### Database Maintenance

**View database statistics:**
```bash
docker compose exec mcpslackbot node -e "
  const { createClient } = require('@libsql/client');
  const db = createClient({ url: 'http://libsql:8080' });
  db.execute('SELECT * FROM tokens').then(r => console.log(JSON.stringify(r.rows, null, 2)));
"
```

**Scheduled backups:**

Create a cron job:
```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * cd /path/to/mcp-slackbot && docker compose down && docker run --rm -v mcp-slackbot_libsql-data:/data -v $(pwd)/backups:/backup alpine tar czf /backup/libsql-$(date +\%Y\%m\%d).tar.gz -C /data . && docker compose up -d
```

## License

This project is licensed under version 3 of the GNU Affero General Public License (AGPL-3.0). See the `LICENSE.TXT` file for details.

## Support

For issues or questions:
- GitHub Issues: https://github.com/freightcognition/mcp-slackbot/issues
- Contact: Anthony Fecarotta (freightCognition / linehaul.ai)
