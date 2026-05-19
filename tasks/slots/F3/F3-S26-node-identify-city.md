---
id: F3-S26
title: Nó identify_city (com confirmação)
phase: F3
task_ref: T3.14
status: in-progress
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T02:56:33Z
completed_at:
pr_url:
depends_on: [F3-S03, F3-S14, F3-S22]
blocks: [F3-S31]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S26 — Nó identify_city

## Objetivo

Resolver a cidade do cliente a partir do texto, pedir confirmação quando o match
for incerto e gravar a cidade no lead.

## Escopo

- `app/graphs/whatsapp_pre_attendance/nodes/identify_city.py`:
  - Chama a tool `identify_city` (F3-S14).
  - `confidence >= 0.85` → grava `city_id`/`city_name` no estado e chama
    `update_lead_profile` (F3-S22).
  - `confidence < 0.85` → compõe pergunta de confirmação com `alternatives`.
  - `out_of_service` → mensagem de fluxo alternativo (cidade não atendida).
- Função pura `(state) -> state`.

## Fora de escopo

- Edges/roteamento da confirmação (F3-S31).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_city.py`
- `apps/langgraph-service/tests/graphs/test_node_identify_city.py`

## Definition of Done

- [ ] Match alto grava cidade no estado + atualiza o lead.
- [ ] Match baixo gera pergunta de confirmação com alternativas.
- [ ] `out_of_service` gera mensagem de fluxo alternativo.
- [ ] Testes com fixtures cobrem os 3 cenários.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
