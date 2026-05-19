---
id: F3-S32
title: POST /process/whatsapp/message no LangGraph
phase: F3
task_ref: T3.17
status: in-progress
priority: critical
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T14:09:40Z
completed_at:
pr_url:
depends_on: [F3-S31]
blocks: [F3-S33]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S32 — Endpoint POST /process/whatsapp/message

## Objetivo

Expor o grafo `whatsapp_pre_attendance` via HTTP no serviço LangGraph, com o
contrato exato do doc 06 §4.

## Escopo

- `app/schemas/inbound.py` / `app/schemas/outbound.py` — Pydantic v2 estrito para
  request (doc 06 §4.1) e response (doc 06 §4.2). Rejeita payload desconhecido.
- `app/api/process.py` — rota `POST /process/whatsapp/message`:
  - Valida o inbound, executa `build_graph()`, monta o response (`reply`, `actions`,
    `handoff`, `state`, `model`, `prompt_version`, `graph_version`, `latency_ms`, `errors`).
  - Rate limit no endpoint (doc 06 §12).
- Registrar a rota em `app/main.py`.
- Testes de integração da rota com LLM/tools mockados.

## LGPD / Segurança

- Validação Pydantic estrita; logs sem CPF/RG/tokens (doc 06 §12).

## Fora de escopo

- Integração do backend (F3-S33). Fallback (F3-S34).

## Arquivos permitidos

- `apps/langgraph-service/app/schemas/__init__.py`
- `apps/langgraph-service/app/schemas/inbound.py`
- `apps/langgraph-service/app/schemas/outbound.py`
- `apps/langgraph-service/app/api/process.py`
- `apps/langgraph-service/app/main.py`
- `apps/langgraph-service/tests/api/test_process_whatsapp.py`

## Definition of Done

- [ ] Request/response validados conforme doc 06 §4.1/§4.2.
- [ ] Payload desconhecido rejeitado.
- [ ] Rate limit ativo no endpoint.
- [ ] Resposta inclui `model`, `prompt_version`, `graph_version`, `latency_ms`.
- [ ] Testes de integração verdes.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
