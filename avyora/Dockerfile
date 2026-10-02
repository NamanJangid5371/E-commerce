# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS migrate
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$RUN_SEED\" = \"true\" ]; then echo '[migrate] RUN_SEED=true — running empty-DB-safe seed'; npx tsx prisma/seed.ts; else echo '[migrate] seed skipped (set RUN_SEED=true only for empty databases)'; fi"]

FROM base AS builder
ARG AVYORA_APP=store
ARG NEXT_PUBLIC_STOREFRONT_ORIGIN=http://localhost:3000
ARG NEXT_PUBLIC_ADMIN_ORIGIN=http://localhost:3001
ARG NEXT_PUBLIC_LOGISTICS_ORIGIN=http://localhost:3002
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID=

ENV AVYORA_APP=${AVYORA_APP}
ENV NEXT_PUBLIC_AVYORA_APP=${AVYORA_APP}
ENV NEXT_PUBLIC_STOREFRONT_ORIGIN=${NEXT_PUBLIC_STOREFRONT_ORIGIN}
ENV NEXT_PUBLIC_ADMIN_ORIGIN=${NEXT_PUBLIC_ADMIN_ORIGIN}
ENV NEXT_PUBLIC_LOGISTICS_ORIGIN=${NEXT_PUBLIC_LOGISTICS_ORIGIN}
ENV NEXT_PUBLIC_RAZORPAY_KEY_ID=${NEXT_PUBLIC_RAZORPAY_KEY_ID}
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

RUN set -eux; \
  case "$AVYORA_APP" in \
    admin) SRC=".next-admin" ;; \
    logistics) SRC=".next-logistics" ;; \
    *) SRC=".next" ;; \
  esac; \
  mkdir -p /standalone-export/.next/static; \
  cp -a "$SRC/standalone/." /standalone-export/; \
  cp -a "$SRC/static/." /standalone-export/.next/static/

FROM base AS runner
ARG AVYORA_APP=store
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV AVYORA_APP=${AVYORA_APP}
ENV NEXT_PUBLIC_AVYORA_APP=${AVYORA_APP}
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache postgresql-client \
  && addgroup -S nodejs && adduser -S nextjs -G nodejs \
  && mkdir -p /app/data /app/backups \
  && chown -R nextjs:nodejs /app

COPY --from=builder --chown=nextjs:nodejs /standalone-export/. ./
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x ./scripts/docker-entrypoint.sh

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
