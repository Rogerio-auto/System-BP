---
id: F16-S36
title: load_state preserva organization_id (não descartar no merge)
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: done
priority: critical
estimated_size: XS
agent_id: python-engineer
claimed_at: '2026-06-18T12:54:56+00:00'
completed_at: 2026-06-18T13:01:56Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/327
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S36 — load_state preserva organization_id

## Objetivo

Garantir que `organization_id` (vindo do request, via F16-S34/S35) **sobreviva** ao nó `load_state` e
chegue aos nós seguintes (`identify_or_create_lead`, `persist_state`, `log_decision`).

## Contexto

**Último blocker do agente IA responder.** F16-S34/S35 colocaram `organization_id` no request e no
estado inicial (`to_payload_dict`), mas o nó `load_state` **reconstrói** o estado no caminho de merge:
`merged = {**_initial_state(loaded), **{conversation_id, chatwoot_conversation_id, phone, messages, ...}}`
(`nodes/load_state.py:122`). Como `loaded` é o estado persistido (gravado por código antigo, sem org)
e os overrides de sessão **não incluem `organization_id`**, o org_id do request é **descartado**.
Resultado em runtime (logs reais 2026-06-18): `state["organization_id"]` vira None → `get-or-create`
sem org (400), `PUT /state` 400, e `log_decision` cai no fallback `_UNKNOWN_ORG = "unknown"` (não-uuid)
→ `POST /ai/decisions` 400. A conversa cai em handoff sem resposta. O backend está correto (curl com
org_id retorna 200) — o defeito é só a perda do org_id no `load_state`.

## Escopo (faz)

- `nodes/load_state.py`: no dict de overrides de sessão do caminho de merge (linha ~122-135), preservar
  `organization_id` com a MESMA precedência dos outros campos de sessão (request autoritativo):
  `"organization_id": state.get("organization_id") or loaded.get("organization_id", "")`.
  Garantir também que o caminho 404 (`_initial_state(state)`) já o preserva (preserva, pois
  `_initial_state` faz `{**defaults, **base}`) — confirmar, não duplicar.
- `state.py`: incluir `organization_id` em `serialize_state` e `deserialize_state` para round-trip
  (assim o estado persistido passa a carregar o org_id nas próximas cargas).
- Teste: após `load_state` (caminho merge com estado persistido SEM org_id), o estado resultante mantém
  o `organization_id` que veio no `state` de entrada (request). Não regredir o caminho 404.

## Fora de escopo (NÃO faz)

- Mudar os tools/nós de escrita (F16-S35 já os corrigiu — eles leem `state["organization_id"]`).
- Backend Node (`apps/api/**`) — já correto.
- Caminho legado chatwoot do `request_handoff`.

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/langgraph-service/app/tools/**`

## Contratos de saída

- Após `load_state`, `state["organization_id"]` == org_id do request (não None, não "unknown").
- Todas as escritas /internal a jusante enviam um org_id uuid válido → 2xx.

## Definition of Done

- [ ] `load_state` (merge) preserva `organization_id` do request (precedência de sessão)
- [ ] `serialize_state`/`deserialize_state` round-trip de `organization_id`
- [ ] Teste cobre: estado persistido sem org + request com org → resultado mantém org do request
- [ ] Caminho 404 (primeira interação) continua com org_id preservado
- [ ] `python -m pytest` + `ruff check app` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- `organization_id` NÃO é PII — pode logar.
- O request é a fonte autoritativa do org_id (single-tenant por ora); persistido é só cache.
- Validar end-to-end: enviar uma saudação e confirmar `get-or-create` 200 + grafo gera resposta
  (reply_type != none, sem handoff por org faltando).
