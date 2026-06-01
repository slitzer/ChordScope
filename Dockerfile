# ChordScope Frontend - Next.js
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./

# Use npm install instead of npm ci (we don't have a lockfile yet)
RUN npm install --legacy-peer-deps

# Copy the rest of the source
COPY . .

# Build the Next.js app
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]