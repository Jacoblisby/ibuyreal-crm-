# iBuyReal CRM — production image.
# Multi-stage build til en lille, robust Coolify-deploy.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# --include=dev tvinger devDeps (Tailwind, drizzle-kit, etc.) selv hvis
# NODE_ENV=production er sat som build-arg (Coolify injecter sådanne).
RUN npm ci --include=dev
COPY . .
ARG DATABASE_URL=""
ARG NEXT_PUBLIC_APP_URL=""
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# Build kører som dev så Tailwind PostCSS-plugin er tilgængelig
ENV NODE_ENV=development
RUN npm run build
ENV NODE_ENV=production

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations + drizzle-kit, så Coolify kan køre `npx drizzle-kit migrate` post-deploy
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/postgres ./node_modules/postgres

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
