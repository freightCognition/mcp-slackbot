# MCP Slackbot

A Slack bot for executing Carrier Risk Assessments using the MCP API within your Slack environment.

## Prerequisites

- Docker and Docker Compose
- A Slack workspace with permissions to add apps
- MyCarrierPackets API access
### Optional
- A Tunnel or Proxy to receive requests and respond with the fetched carrier data.

## Quick Start with Docker Compose

1. Clone the repository:
```bash
git clone https://github.com/yourusername/mcp-slackbot-v2.1.git
cd mcp-slackbot
```

2. Configure environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and fill in your credentials:
     - `BEARER_TOKEN`: Your MyCarrierPackets API bearer token
     - `SLACK_BOT_TOKEN`: Your Slack bot's token
     - `SLACK_SIGNING_SECRET`: Your Slack app's signing secret
     - `SLACK_WEBHOOK_URL`: Your Slack webhook URL
     - `PORT`: The port number for the application (default: 3001 - you do not have to change this unless there is a conflict on your server)

3. Start the application:
```bash
# Production mode
docker compose up -d

# Development mode with debugging
docker compose -f docker-compose.debug.yml up
```

4. Verify the application is running:
```bash
# Check container status
docker compose ps

# View logs
docker compose logs -f
```

## Security Notes

- Never commit the `.env` file to version control
- Keep your API tokens and secrets secure
- Regularly rotate your credentials
- Use environment variables for all sensitive information
- The `.env.example` file is a template and should not contain real credentials

## Alternative Deployment Methods

If you prefer not to use Docker, you can run the application directly:

### Prerequisites for Direct Deployment
- Node.js >= 18.0.0

### Local Development
```bash
npm install
npm run dev
```

### Production with PM2
```bash
npm install
npm run pm2:start  # Start the application
npm run pm2:stop   # Stop the application
npm run pm2:logs   # View logs
```

## Testing

To test your bearer token:
```bash
# Using Docker
docker compose run --rm mcpslackbot npm run test:token

# Without Docker
npm run test:token
```

## License

Mozilla Public License 2.0

#### Sidenote
If you find this task overwhelming, please do not hesitate to contact me for any questions or assistance in setting it up on a VPS. Alternatively, we can negotiate a small fee for me to host it on our server infrastructure to make things easier for you.
