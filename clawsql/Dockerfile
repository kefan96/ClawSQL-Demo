FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install --silent

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Default config
ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["--help"]