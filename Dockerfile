FROM node:22-alpine

LABEL org.opencontainers.image.title="mcp-slackbot"
LABEL org.opencontainers.image.description="Slack bot for Carrier Risk Assessments via MyCarrierPortal API"
LABEL org.opencontainers.image.source="https://github.com/freightcognition/mcp-slackbot"
LABEL org.opencontainers.image.vendor="freightCognition"

WORKDIR /usr/src/app

# Enable pnpm via corepack (ships with Node 22)
RUN corepack enable

# Install dependencies first (cached layer)
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy app source
COPY --chown=node:node . .

# Use non-root user (the `node` user ships with node:22-alpine)
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "app.js"]
