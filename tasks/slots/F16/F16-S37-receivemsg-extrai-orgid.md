---
id: F16-S37
title: receive_message extrai organization_id do payload (estado inicial)
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: in-progress
priority: critical
estimated_size: XS
agent_id: null
claimed_at: 2026-06-18T13:20:44Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S37 — receive_message extrai organization_id do payload

## Objetivo

Fazer o nó `receive_message` (que monta o **estado inicial** do grafo a partir do payload HTTP)
copiar `organization_id` do payload para o `ConversationState`, fechando a última perda do org_id.

## Contexto

**Elo final da cadeia org_id (depois de F16-S34/S35/S36).** Confirmado com logs reais + leitura do
código (2026-06-18): `process.py:362-364` faz `initial_state = receive_message({}, payload=payload.to_payload_dict())`.
O `payload_dict` JÁ tem `organization_id` (F16-S35), mas `receive_message`
(`nodes/receive_message.py`) extrai `conversation_id`, `phone`, `lead_id`, `city_id`... do payload e
**nunca extrai `organization_id`** — seu dict `updates` não inclui o campo, e como o `state` de entrada
é `{}`, o `{**state, **updates}` resulta SEM org_id. Por isso `load_state` loga
`organization_id: "<missing>"` (o fix de F16-S36 não tinha o que preservar), e todas as escritas
`/internal` falham (get-or-create/PUT state/ai decisions) → a IA cai em handoff sem responder.
O backend e os elos S34/S35/S36 estão corretos; falta só este.

## Escopo (faz)

- `nodes/receive_message.py`: extrair `organization_id` do payload (fonte autoritativa) e incluí-lo no
  `updates`, com a mesma precedência dos demais campos de sessão:
  `organization_id: str = payload.get("organization_id", state.get("organization_id", ""))` →
  `updates["organization_id"] = organization_id`.
- Teste end-to-end do estado inicial: dado um `payload` com `organization_id`, após
  `receive_message({}, payload=...)` o estado resultante contém `organization_id` igual ao do payload.
- Teste de propagação (anti-regressão de 4º elo): simular a sequência receive_message → load_state
  (caminho merge, estado persistido SEM org) e asserir que `organization_id` do payload sobrevive até
  o estado final entregue aos nós de escrita (ou, no mínimo, após load_state). Reusar/estender os
  testes de F16-S36 se fizer sentido.

## Fora de escopo (NÃO faz)

- Backend Node (`apps/api/**`) — correto.
- Tools de escrita e load_state — já corrigidos (F16-S35/S36); apenas reusar nos testes de propagação.

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/receive_message.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/langgraph-service/app/api/process.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`

## Contratos de saída

- Após `receive_message`, `state["organization_id"]` == `payload["organization_id"]`.
- `load_state` (F16-S36) então o preserva → nós de escrita recebem org_id uuid válido → 2xx.

## Definition of Done

- [ ] `receive_message` extrai `organization_id` do payload para o `updates`/estado
- [ ] Teste: `receive_message({}, payload com org)` → estado tem o org_id
- [ ] Teste de propagação: org_id do payload sobrevive receive_message → load_state (sem `<missing>`)
- [ ] `python -m pytest` + `ruff check app` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- `organization_id` NÃO é PII — pode logar (útil incluir no log `receive_message_done` pra debug).
- Payload é a fonte autoritativa; `state` de entrada normalmente é `{}` (vem de `process.py:362`).
- **IMPORTANTE:** trace a cadeia INTEIRA do org_id do payload até `identify_or_create_lead`/`persist_state`/
  `log_decision` e garanta que NENHUM outro nó intermediário (ex: `classify_intent`, nós de rota) o
  descarta — o teste de propagação deve provar isso. Se achar outro ponto de perda, reporte (não saia
  do `files_allowed` — abra como achado para um slot seguinte).
