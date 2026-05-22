---
id: F7-S02
title: CI — E2E smoke test (docker-compose + fluxo crítico)
phase: F7
task_ref: T7.2
status: available
priority: critical
estimated_size: M
agent_id: qa-tester
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F3-S33, F3-S34]
blocks: [F7-S09]
labels: []
source_docs:
  - docs/02-arquitetura-sistema.md
  - docs/13-criterios-aceite.md
---

# F7-S02 — CI E2E smoke test

## Objetivo

Subir a stack completa (Postgres + API + LangGraph + worker outbox) no CI e executar o caminho crítico ponta a ponta — lead chega via webhook WhatsApp → IA processa → simulação gerada → resposta enviada. Bloqueia merge se quebrar. Hoje o CI roda apenas unit + typecheck/lint, e bugs de integração só aparecem em staging.

## Escopo

- Novo workflow `.github/workflows/e2e.yml`:
  - Triggers: `pull_request` em `main` (concorrência: cancel-in-progress)
  - Job único `e2e-smoke`:
    - Checkout
    - `docker compose -f docker-compose.ci.yml up -d` (Postgres + API + LangGraph)
    - Espera healthchecks (timeout 90s)
    - Roda `pnpm --filter @elemento/api db:migrate`
    - Roda script de seed mínimo (1 organização, 1 cidade, 1 user admin, 1 credit_product com regra ativa)
    - Executa suíte `apps/api/test/e2e/` (Vitest com tag `@e2e`)
    - `docker compose down`
- Novo arquivo `docker-compose.ci.yml` na raiz — versão otimizada do compose principal (sem volumes persistentes, healthchecks apertados, image tags pinned)
- Suite `apps/api/test/e2e/whatsapp-lead-to-simulation.e2e.test.ts`:
  - POST `/webhooks/whatsapp` com payload sintético (mensagem "Quero simular crédito de 5000 em 12 meses")
  - Espera worker outbox processar
  - Asserções:
    - 1 `lead` criado com `source='whatsapp'`
    - 1 `chatwoot_conversation` linkada
    - LangGraph foi chamado (`ai_decision_logs` tem entry com `node_name='classify_intent'`)
    - 1 `credit_simulation` gerada
    - Resposta WhatsApp registrada em `whatsapp_messages` com `direction='out'`
    - `ai_conversation_states` persistido
  - Cleanup: `DELETE FROM` nas tabelas tocadas
- Suite `apps/api/test/e2e/handoff-on-langgraph-failure.e2e.test.ts`:
  - Mock LangGraph indisponível (env `LANGGRAPH_BASE_URL` aponta para porta morta)
  - POST webhook → assert `chatwoot_handoff` criado com `reason='ai_unavailable'` + mensagem fallback registrada
- Documentar em `apps/api/test/e2e/README.md` como rodar localmente (`pnpm e2e`)

## Fora de escopo

- Testes de carga (Lighthouse, k6) — slot futuro
- E2E para frontend (Playwright) — slot dedicado pós-launch
- Múltiplos cenários de conversa — usar fixtures de F3-S35

## Arquivos permitidos

```
.github/workflows/e2e.yml
docker-compose.ci.yml
apps/api/test/e2e/setup.ts
apps/api/test/e2e/teardown.ts
apps/api/test/e2e/whatsapp-lead-to-simulation.e2e.test.ts
apps/api/test/e2e/handoff-on-langgraph-failure.e2e.test.ts
apps/api/test/e2e/seed-minimum.ts
apps/api/test/e2e/README.md
apps/api/vitest.config.ts
apps/api/package.json
```

## Definition of Done

- [ ] Workflow `e2e.yml` roda em PRs contra main
- [ ] `docker-compose.ci.yml` sobe stack em < 60s
- [ ] Healthcheck de cada serviço respeitado antes de rodar testes
- [ ] 2 cenários cobertos (golden path + falha LangGraph)
- [ ] Seed mínimo idempotente (rodar 2x = mesmo estado)
- [ ] `pnpm e2e` script funciona localmente
- [ ] README explica setup + troubleshooting
- [ ] PR demonstrando que workflow falha quando esperado (PR de teste opcional)

## Validação

```powershell
docker compose -f docker-compose.ci.yml up -d
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api e2e
docker compose -f docker-compose.ci.yml down
```
