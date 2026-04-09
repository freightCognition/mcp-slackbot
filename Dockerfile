FROM oven/bun:1.2.12-alpine

LABEL org.opencontainers.image.title="mcp-slackbot"
LABEL org.opencontainers.image.description="Slack bot for Carrier Risk Assessments via MyCarrierPortal API"
LABEL org.opencontainers.image.source="https://github.com/freightcognition/mcp-slackbot"
LABEL org.opencontainers.image.vendor="freightCognition"

WORKDIR /usr/src/app

# Install dependencies first (cached layer)
COPY --chown=bun:bun package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy app source
COPY --chown=bun:bun . .

# Use non-root user
USER bun

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["bun", "app.js"]
