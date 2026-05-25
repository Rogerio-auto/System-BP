---
id: F4-S05
title: Worker kanban-on-analysis — promoção aprova/recusa move o card
phase: F4
task_ref: T4.5
status: review
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-25T16:37:19Z
completed_at: 2026-05-25T16:48:36Z
pr_url: null
depends_on: [F4-S02, F1-S13, F1-S15, F2-S09]
blocks: []
labels: []
source_docs:
  - docs/04-eventos.md
  - docs/05-modulos-funcionais.md
---

# F4-S05 — Worker kanban-on-analysis

## Objetivo

Consumir o evento `credit_analysis.status_changed` (emitido em F4-S02) e movimentar o card do Kanban para o estágio adequado de forma idempotente — fechando o loop entre decisão do analista e estado visual do lead.

## Escopo

- Worker `apps/api/src/workers/kanban-on-analysis.ts`:
  - Consome `credit_analysis.status_changed` do outbox
  - Regras de transição:
    | from_status | to_status | Ação no Kanban |
    | --- | --- | --- |
    | qualquer | `aprovado` | move card para `concluido`, `outcome=aprovado`, registra em `kanban_stage_history` |
    | qualquer | `recusado` | move card para `concluido`, `outcome=recusado`, registra histórico |
    | `aprovado`/`recusado` | `em_analise` (request-review) | move card de volta para `analise_credito`, `outcome=pending`, registra histórico |
  - Idempotente via `event_processing_logs` (já existe — usar `unique (event_id, handler_name)`)
  - Atualiza `kanban_cards.last_analysis_id`
- Registrar worker em `apps/api/src/workers/index.ts`
- Testes de integração que disparam o evento e asseguram movimento + idempotência (rodar handler 2x → 1 movimento)

## Fora de escopo

- Eventos para webhook externo (futuro)
- Notificação WhatsApp ao cliente sobre decisão (slot futuro de comunicação)

## Arquivos permitidos

```
apps/api/src/workers/kanban-on-analysis.ts
apps/api/src/workers/index.ts
apps/api/src/workers/__tests__/kanban-on-analysis.test.ts
```

## Definition of Done

- [ ] Worker registrado e sobe junto com `pnpm dev`
- [ ] 3 transições cobertas
- [ ] Idempotência testada (mesmo evento processado 2x → 1 movimento, 1 entry no histórico)
- [ ] Log estruturado por movimento (`analysis_id`, `card_id`, `from_stage`, `to_stage`)
- [ ] Erro de movimento (card não encontrado, transição inválida) marca evento como `failed` com `last_error` legível — não em loop

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- kanban-on-analysis
```
