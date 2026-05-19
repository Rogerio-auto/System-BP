---
id: F3-S27
title: Nó qualify_credit_interest
phase: F3
task_ref: T3.15
status: in-progress
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T03:20:56Z
completed_at:
pr_url:
depends_on: [F3-S00, F3-S03]
blocks: [F3-S31]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S27 — Nó qualify_credit_interest

## Objetivo

Coletar valor desejado, prazo e intenção de crédito do cliente, via conversa
guiada por LLM, preenchendo `missing_fields` até estar pronto para simular.

## Escopo

- `app/prompts/pre_attendance_qualify.md` — prompt de qualificação versionado
  (header YAML), com restrições do doc 06 §5.6.
- `app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`:
  - Usa o `LLMGateway` via `for_role("reasoner")` (F3-S00).
  - Extrai `requested_amount` e `requested_term_months` do diálogo.
  - Atualiza `missing_fields`; se faltar dado, compõe a próxima pergunta.
  - DLP no texto do cliente antes do gateway.
- Testes com fixtures + LLM mockado.

## Fora de escopo

- Geração da simulação (F3-S28). Edges (F3-S31).

## Arquivos permitidos

- `apps/langgraph-service/app/prompts/pre_attendance_qualify.md`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`
- `apps/langgraph-service/tests/graphs/test_node_qualify.py`

## Definition of Done

- [ ] Valor e prazo extraídos e gravados no estado.
- [ ] `missing_fields` reflete o que ainda falta; gera próxima pergunta.
- [ ] Prompt versionado; DLP aplicado.
- [ ] Testes com fixtures (dado completo, dado parcial).
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
