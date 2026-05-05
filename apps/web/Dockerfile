# =============================================================================
# Dockerfile — apps/web (PRODUÇÃO)
# Build estático servido por nginx-alpine. Multi-stage. Non-root.
# Context = repo root (precisa do monorepo p/ resolver workspaces).
# =============================================================================
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter @elemento/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
