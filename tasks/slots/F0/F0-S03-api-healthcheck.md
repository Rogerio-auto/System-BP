---
id: F0-S03
title: Validar boot da API + healthcheck contra Postgres
phase: F0
task_ref: T0.4
status: claimed
priority: high
estimated_size: S
agent_id: claude-opus-4-7
claimed_at: 2026-05-10T00:00:00Z
completed_at: null
pr_url: null
depends_on: [F0-S01]
blocks: [F1-S01]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.4
  - apps/api/src/app.ts
---

# F0-S03 — Boot da API + healthcheck

## Objetivo
`docker compose up -d postgres` + `pnpm --filter @elemento/api dev` + `curl /health` retorna `{ status: "ok", checks: { db: "ok" } }`.

## Escopo
- Confirmar que `apps/api/src/app.ts` e `server.ts` sobem sem erro com `.env` válido.
- Adicionar teste de integração mínimo em `apps/api/src/modules/health/health.test.ts` que:
  1. Sobe app via `buildApp()`.
  2. Faz `app.inject({ method: 'GET', url: '/health' })`.
  3. Verifica status 200 e shape do payload.
- Configurar Vitest base em `apps/api/vitest.config.ts`.

## Fora de escopo
- Login, auth, qualquer rota além de `/health`.
- Migrations (slot F0-S04).

## Arquivos permitidos
- `apps/api/vitest.config.ts`
- `apps/api/src/modules/health/health.test.ts`
- `apps/api/src/test/setup.ts` (se necessário)

## Arquivos proibidos
- `apps/api/src/app.ts` (já implementado — só altere se houver bug)
- `apps/api/src/server.ts`

## Contratos de saída
- `pnpm --filter @elemento/api test` passa.

## Definition of Done
- [ ] Vitest configurado
- [ ] Teste de `/health` passando (com mock de pool se DB não disponível em CI)
- [ ] `pnpm test` verde
- [ ] PR aberto

## Validação
```powershell
docker compose up -d postgres
pnpm --filter @elemento/api dev
# em outra shell:
curl http://localhost:3333/health
pnpm --filter @elemento/api test
```
