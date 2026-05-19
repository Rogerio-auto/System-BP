---
id: F3-S16
title: Tool generate_credit_simulation (Python)
phase: F3
task_ref: T3.7
status: done
priority: high
estimated_size: S
agent_id: python-engineer
claimed_at: 2026-05-19T02:17:02Z
completed_at: 2026-05-19T02:25:04Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/93
depends_on: [F3-S15]
blocks: [F3-S28]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S16 — Tool generate_credit_simulation

## Objetivo

Tool LangGraph que chama `POST /internal/simulations` — **endpoint já existente
(F2-S05, done)**. Este slot é só o lado Python da tool.

## Escopo

- `app/tools/simulation_tools.py` — tool `generate_credit_simulation`:
  - Input `{ lead_id, amount, term_months, product_id? }` (doc 06 §7.3).
  - Output: `simulation_id`, parcela, total, juros, taxa, `rule_version`.
  - **Idempotency key** no padrão do doc 06 §7.3:
    `sim_<lead_id>_<amount>_<term>_<product_id>_<minute_bucket>`.
  - Cliente HTTP `_base.py` com `X-Internal-Token`, `X-Correlation-Id`, `Idempotency-Key`.
  - Mapeia erros: `AMOUNT_OUT_OF_RANGE`, `TERM_OUT_OF_RANGE`, `NO_RULE_FOR_CITY`,
    `NO_ACTIVE_PRODUCT`.
- Testes `httpx_mock`: sucesso, reenvio idempotente (mesma chave → mesma simulação),
  cada erro de range.

## Fora de escopo

- Endpoint (já feito em F2-S05). Nó `generate_simulation` (F3-S28).

## Arquivos permitidos

- `apps/langgraph-service/app/tools/simulation_tools.py`
- `apps/langgraph-service/tests/tools/test_simulation_tools.py`

## Definition of Done

- [ ] Idempotency key gerada no padrão do doc 06 §7.3.
- [ ] I/O Pydantic v2; erros de range mapeados.
- [ ] Reenvio com mesma chave retorna a mesma simulação.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
