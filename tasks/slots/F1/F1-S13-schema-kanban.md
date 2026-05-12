---
id: F1-S13
title: Schema kanban + service de transições válidas
phase: F1
task_ref: T1.13
status: done
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-12T15:25:00Z
completed_at: 2026-05-12T15:48:00Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/27
depends_on: [F1-S04, F1-S09]
blocks: [F1-S14]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/12-tasks-tecnicas.md#T1.13
---

# F1-S13 — Schema + service kanban

## Objetivo

`kanban_stages`, `kanban_cards`, `kanban_stage_history` com matriz de transições válidas no service. Endpoint para mover card valida transição + permissão + escopo.

## Escopo

- Schemas Drizzle.
- `kanbanService.moveCard(cardId, toStageId, actor)`:
  - valida transição em matriz (definida em código)
  - registra histórico append-only
  - emite `kanban.stage_updated` via outbox
- Endpoint `POST /api/kanban/cards/:id/move`.
- Testes da matriz de transições.

## Definition of Done

- [ ] Matriz documentada em código com comentários
- [ ] Transição inválida retorna 422
- [ ] Histórico nunca alterado
- [ ] PR aberto
