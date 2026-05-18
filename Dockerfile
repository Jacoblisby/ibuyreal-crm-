# iBuyReal CRM — production image.
# Multi-stage build til en lille, robust Coolify-deploy.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
# --include=dev tvinger devDeps (Tailwind, drizzle-kit) selv om NODE_ENV
# er sat til production af Coolify's build-args.
RUN npm ci --include=dev
COPY . .
ARG DATABASE_URL=""
ARG NEXT_PUBLIC_APP_URL=""
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# NODE_ENV=production for at Next.js bygger production-mode artifacts
ENV NODE_ENV=production
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user (Debian-slim syntax)
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -s /bin/sh -m nextjs

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
