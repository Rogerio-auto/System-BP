---
id: F1-S14
title: Frontend Kanban (board + detalhe modal)
phase: F1
task_ref: T1.14
status: blocked
priority: medium
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S08, F1-S13]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.14
---

# F1-S14 — Frontend Kanban

## Objetivo
Tela `/kanban` com board drag-and-drop, modal de detalhe do card, filtros.

## Escopo
- Lib drag: `@dnd-kit/core` (justificar no PR).
- Otimismo no UI com rollback em erro de transição.
- Filtros: cidade, agente, faixa de valor, range de data.

## Definition of Done
- [ ] Drag entre colunas válido funciona
- [ ] Drag inválido faz rollback com toast
- [ ] PR com recording
