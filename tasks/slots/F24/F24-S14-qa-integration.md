---
id: F24-S14
title: QA — testes de integração do sistema de notificações
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: available
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S06, F24-S07, F24-S08, F24-S09]
blocks: []
labels: [qa, notifications, security, multi-tenant, lgpd-impact]
source_docs: [docs/planejamento-notificacoes.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F24-S14 — QA: integração do sistema de notificações

## Objetivo

Cobrir end-to-end (harness real-DB) o motor de notificações: fan-out por evento, worker de
estagnação, dedup/cooldown, preferências por categoria, isolamento RBAC/org e envio de email mockado.

## Contexto

Planejamento §7/§9. Usar o harness real-DB já existente nos testes de integração da API. Email mockado
(sem chamar Resend). Validar idempotência via `notification_rule_deliveries`.

## Escopo (faz)

- Fan-out por evento: regra `enabled` → evento → notificação in-app criada para os destinatários certos;
  preferências desligadas suprimem canal; idempotência por `event_id` (reprocesso não duplica).
- Worker de estagnação: entidade parada além do threshold → 1 disparo; cooldown evita repique.
- Preferências por categoria: override de categoria vs default do canal.
- RBAC/org: `notifications:manage` exigido no CRUD; nenhuma regra/notificação cruza org/cidade.
- Email: sender chamado com email correto (mock), redacted em log; no-op quando flag off.

## Fora de escopo (NÃO faz)

- Código de produção (só testes/fixtures).
- UI tests do front.

## Arquivos permitidos

- `apps/api/src/modules/notification-rules/__tests__/integration.test.ts`
- `apps/api/src/handlers/__tests__/fanout-integration.test.ts`
- `apps/api/src/workers/__tests__/sla-scan-integration.test.ts`
- `apps/api/src/modules/notifications/__tests__/preferences-integration.test.ts`
- `test-fixtures/notifications.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] Fan-out por evento coberto (destinatários, preferências, idempotência)
- [ ] Worker de estagnação coberto (threshold + cooldown)
- [ ] Preferências por categoria cobertas
- [ ] Isolamento RBAC/org/cidade verificado
- [ ] Email mockado + redact verificados
- [ ] `pnpm --filter @elemento/api test` verde + `auto-review` sem HIGH

## Validação

```powershell
pnpm --filter @elemento/api test
python scripts/slot.py auto-review F24-S14 --json
python scripts/slot.py validate F24-S14
```

## Notas para o agente

- E2E Smoke é o gate real de migrations — garantir que as tabelas de F24-S01/S02 estão aplicadas.
- Nunca chamar Resend de verdade — mock do `resendClient`.
