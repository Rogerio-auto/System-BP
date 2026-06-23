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
# VITE_API_URL é inlined em build-time pelo Vite. Em prod, passar via build-arg:
#   docker build --build-arg VITE_API_URL=https://api.bancodopovoderondonia.org.br ...
ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=$VITE_API_URL
# Buildar libs de workspace primeiro — sem o dist/, o `tsc -b` do web não resolve
# @elemento/shared-schemas e cascateia erros de tipo. Espelha apps/api/Dockerfile.
RUN pnpm --filter @elemento/shared-types build
RUN pnpm --filter @elemento/shared-schemas build
RUN pnpm --filter @elemento/web build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
