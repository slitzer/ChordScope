# ChordScope Frontend - Next.js (Improved)
# Multi-stage build with proper build-time env var support + standalone output

FROM node:20-alpine AS builder

WORKDIR /app

# Accept the analyzer URL as a build argument (required for NEXT_PUBLIC_ vars)
ARG NEXT_PUBLIC_ANALYZER_URL=http://localhost:8000
ENV NEXT_PUBLIC_ANALYZER_URL=$NEXT_PUBLIC_ANALYZER_URL

# Install dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build the app (NEXT_PUBLIC_ vars are inlined here)
RUN npm run build

# Production runner - use standalone output properly
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy standalone server and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy public folder (required for images, themes, static assets in standalone mode)
COPY --from=builder /app/public ./public

# Ensure themes folder is present and has correct permissions
RUN chmod -R 755 /app/public/themes || true

EXPOSE 3000

# Use the standalone server (fixes the "next start" warning)
CMD ["node", "server.js"]
