FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Create directory for database if it doesn't exist
RUN mkdir -p backups

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
