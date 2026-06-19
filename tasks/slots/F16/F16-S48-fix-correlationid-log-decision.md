---
id: F16-S48
title: Fix correlationId não-UUID no nó log_decision (auditoria final 400)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S48 — Fix correlationId não-UUID no log_decision

## Objetivo

No 3º smoke real o agente respondeu certo (`reply_type=text`, `handoff=false`), mas o nó FINAL
`log_decision` deu **400** em `POST /internal/ai/decisions`: `correlationId deve ser UUID válido`.
Causa: o `correlation_id` do contexto structlog é `livechat_msg_<uuid>` (NÃO é UUID puro); o S46
fez o `log_decision` preferir esse valor de contexto. O `agent_turn` usa `conversation_id` (UUID) e
por isso passa. NÃO-FATAL (auditoria final redundante — o agent_turn já gravou a decisão), mas é erro
de log a eliminar.

## Escopo (faz)

- `log_decision.py`: usar um **UUID válido** no `correlationId`. Preferir `conversation_id` (UUID
  garantido pelo inbound, como o `agent_turn` já faz); só cair em `uuid4()` se ausente. Não usar o
  `correlation_id` de contexto se não for UUID (ou extrair o sufixo UUID de `livechat_msg_<uuid>`).
- Teste cobrindo: contexto `correlation_id="livechat_msg_<uuid>"` → o payload enviado usa um UUID válido.

## Fora de escopo

- Mudar o formato do `correlation_id` do sistema (`livechat_msg_<uuid>`) — é usado para tracing.
- Backend / apps/api.

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/log_decision.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`

## Definition of Done

- [ ] `log_decision` envia `correlationId` UUID válido → `POST /internal/ai/decisions` 2xx no fluxo real
- [ ] Teste do correlationId não-UUID → normalizado p/ UUID
- [ ] `pytest` + `ruff` + `mypy` verdes
- [ ] PR aberto

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```
