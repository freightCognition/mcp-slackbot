FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy app source
COPY . .

# Set proper permissions
RUN chown -R node:node /usr/src/app

# Use non-root user
USER node

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]

docs/

thoughts/