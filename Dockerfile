FROM oven/bun:1-alpine

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

CMD ["bun", "run", "start"]
