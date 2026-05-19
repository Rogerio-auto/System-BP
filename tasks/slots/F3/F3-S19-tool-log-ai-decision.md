---
id: F3-S19
title: Tool log_ai_decision (Python)
phase: F3
task_ref: T3.10
status: done
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T01:45:58Z
completed_at: 2026-05-19T01:56:48Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/92
depends_on: [F3-S09]
blocks: [F3-S30]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S19 — Tool log_ai_decision

## Objetivo

Tool LangGraph que chama `POST /internal/ai/decisions` (F3-S09). Usada pelo nó
final `log_decision` para registrar o turno em `ai_decision_logs`.

## Escopo

- `app/tools/audit_tools.py` — tool `log_ai_decision`:
  - Input agregando os dados do turno (doc 06 §7.9): `conversation_id, lead_id?,
node_name, intent?, prompt_key?, prompt_version?, model?, tokens_*, latency_ms?,
decision, error?, correlation_id`.
  - Output `{ decision_log_id }`.
  - Cliente HTTP `_base.py` com headers obrigatórios.
  - `decision` **nunca** carrega PII bruta (doc 17 §3.4).
- Testes `httpx_mock`: log gravado, log com `error` preenchido.

## Fora de escopo

- Endpoint Node (F3-S09). Nó `log_decision` (F3-S30).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/audit_tools.py`
- `apps/langgraph-service/tests/tools/test_audit_tools.py`

## Definition of Done

- [ ] Tool chama o endpoint com headers obrigatórios.
- [ ] I/O Pydantic v2; `decision` sem PII bruta.
- [ ] Testes cobrem log de sucesso e log de erro.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
