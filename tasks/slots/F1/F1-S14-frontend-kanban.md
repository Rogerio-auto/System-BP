---
id: F1-S14
title: Frontend Kanban (board + detalhe modal)
phase: F1
task_ref: T1.14
status: done
priority: medium
estimated_size: L
agent_id: frontend-engineer
claimed_at: '2026-05-12T15:55:00Z'
completed_at: '2026-05-12T16:13:00Z'
pr_url: https://github.com/Rogerio-auto/System-BP/pull/29
depends_on: [F1-S08, F1-S13]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T1.14
  - docs/18-design-system.md
  - docs/design-system/index.html
---

# F1-S14 — Frontend Kanban

## Objetivo

Tela `/kanban` com board drag-and-drop, modal de detalhe do card, filtros.

## Escopo

- Lib drag: `@dnd-kit/core` (justificar no PR).
- Colunas com header em caption-style (uppercase tracking), contagem de cards em badge neutro, body com `bg-elev-2`, `box-shadow: var(--elev-1)`.
- Cards seguem o componente `Card` do DS (§9.3): `bg-elev-1`, `elev-2`, hover Spotlight (halo verde acompanha cursor). Durante drag: `elev-4` + leve `scale(1.02)` + opacity 0.95.
- Drop zones com indicador visual: `border-dashed` na cor `--brand-azul` quando arrastando sobre coluna válida; `--danger` quando inválida.
- Otimismo no UI com rollback em erro de transição. Toast em `--elev-5` no canto inferior direito com animação fade-up.
- Filtros: cidade, agente, faixa de valor, range de data — em barra superior compacta, `Input`/`Select` do DS.
- Empty state por coluna com ilustração SVG inline + texto caption.

## Definition of Done

- [ ] Drag entre colunas válido funciona com feedback visual de Lift+Spotlight
- [ ] Drag inválido faz rollback com toast em `--elev-5`
- [ ] Cards seguem o `Card` canônico do DS, com hover Spotlight
- [ ] Funciona em ambos os temas
- [ ] PR com recording (preferencialmente nos 2 temas)
