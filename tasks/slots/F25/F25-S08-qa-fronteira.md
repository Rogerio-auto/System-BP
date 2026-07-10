---
id: F25-S08
title: QA — testes de integração da fronteira IA↔humano (escopo, idempotência, reversão, flag)
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: medium
estimated_size: M
agent_id: null
depends_on: [F25-S03, F25-S05, F25-S06]
blocks: []
labels: [qa, ai-agent, rbac, lgpd]
source_docs: [docs/22-agente-interno-acoes.md, docs/13-criterios-aceite.md]
docs_required: false
claimed_at: 2026-07-10T17:35:25Z
completed_at: 2026-07-10T18:06:13Z
---

# F25-S08 — QA: fronteira do agente no funil

## Objetivo

Provar, com testes de integração real-DB, que as ações da IA respeitam a fronteira do doc 22 §4
e as regras invioláveis (escopo de cidade, idempotência, reversibilidade, flag).

## Escopo (faz)

- Testes de integração cobrindo:
  - `qualify` idempotente (2ª chamada = no-op); emite `leads.qualified` uma vez; audit `actor_type='ai'`.
  - Worker de qualificação reflete no card sem pular para `simulacao`.
  - Housekeeping: estagnação sinaliza sem mudar terminal; abandono após limiar → `closed_lost`
    reversível; **nunca** age em lead em Documentação+.
  - Reversão: `POST /api/ai-actions/:id/revert` reabre o lead, preserva histórico, audit com usuário.
  - **Escopo de cidade:** gestor_regional/agente só veem/revertem ações da sua cidade; negação não
    vaza existência de outra cidade.
  - **Flag OFF:** nenhuma ação de escrita da IA ocorre (worker no-op; tool `FEATURE_DISABLED`).
  - **LGPD:** nenhum evento/log de ação da IA carrega PII bruta.

## Fora de escopo (NÃO faz)

- Implementação de features (S03/S05/S06/S07).
- Testes de UI (podem ficar no slot de frontend).

## Arquivos permitidos

- `apps/api/src/modules/ai-actions/__tests__/**`
- `apps/api/src/workers/__tests__/funnel-housekeeping.integration.test.ts`
- `apps/api/src/workers/__tests__/kanban-on-qualification.integration.test.ts`
- `apps/api/test/**`

## Arquivos proibidos

- Código de produção (qualquer `.ts` fora de `__tests__`/`test`)
- `apps/web/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Cobertura das 7 famílias de cenário acima, com harness real-DB
- [ ] Escopo de cidade e flag OFF explicitamente testados
- [ ] Asserção de "sem PII bruta" em eventos/logs de ação da IA
- [ ] `pnpm --filter @elemento/api test` verde

## Validação

```powershell
pnpm --filter @elemento/api test
python scripts/slot.py validate F25-S08
```

## Notas para o agente

- Usar o harness real-DB de integração já ligado no CI (ver F23). Mockar `emit` esconde bugs — preferir DB real.
- Só pode editar arquivos de teste/fixtures.
