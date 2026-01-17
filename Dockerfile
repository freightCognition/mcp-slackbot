FROM oven/bun:1-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --production

# Copy app source
COPY . .

# Set proper permissions (bun user exists in oven/bun image)
RUN chown -R bun:bun /usr/src/app

# Use non-root user
USER bun

# Expose port for health check endpoint (Bolt customRoutes)
EXPOSE 3001

# Start the application
CMD ["bun", "run", "start"]
