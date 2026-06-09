# =============================================================================
# Dockerfile — apps/api (PRODUÇÃO)
# Multi-stage. Non-root. Sem dev tools no final. Sem --reload.
# =============================================================================
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
# shared-schemas has zod as a direct dep → pnpm installs it in its own
# node_modules. Without this COPY, tsc cannot resolve `import { z } from 'zod'`
# inside packages/shared-schemas/src/*.ts when building @elemento/api, because
# module resolution walks up from the file's directory — not from apps/api.
COPY --from=deps /repo/packages/shared-schemas/node_modules ./packages/shared-schemas/node_modules
COPY . .
# Build workspace libs first so their dist/ exists before api tsc runs.
# turbo dependsOn ["^build"] handles ordering in monorepo, but Docker does not
# run turbo here — we invoke pnpm --filter directly and must respect the order.
# shared-types must build before shared-schemas/api (both consume its dist).
RUN pnpm --filter @elemento/shared-types build
RUN pnpm --filter @elemento/shared-schemas build
RUN pnpm --filter @elemento/api build
RUN pnpm --filter @elemento/api deploy --prod /out

FROM node:20-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=app:app /out/dist ./dist
COPY --from=builder --chown=app:app /out/node_modules ./node_modules
COPY --from=builder --chown=app:app /out/package.json ./package.json
USER app
EXPOSE 3333
CMD ["node", "dist/server.js"]
