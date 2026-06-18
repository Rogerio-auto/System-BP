---
id: F16-S35
title: LangGraph propaga organization_id em todas as chamadas /internal de escrita
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: in-progress
priority: critical
estimated_size: M
agent_id: python-engineer
claimed_at: "2026-06-18T03:38:23Z"
completed_at: null
pr_url: null
depends_on: [F16-S34]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S35 — LangGraph propaga organization_id nas escritas /internal

## Objetivo

Receber `organization_id` no request do LangGraph, carregá-lo no `ConversationState`, e enviá-lo em
**todas** as chamadas `/internal/*` de escrita do grafo whatsapp_pre_attendance — eliminando os 400
`organization_id é obrigatório` que hoje impedem o agente IA de responder.

## Contexto

**Blocker do agente IA (lado LangGraph), par do F16-S34.** Os endpoints `/internal/*` exigem
`organization_id` no body (multi-tenant), mas o LangGraph nunca o tinha — não está no request, nem no
state, nem em settings. Logo, `POST /internal/leads/get-or-create`, `PUT /internal/conversations/:id/state`
e `POST /internal/ai/decisions` voltam **400** e o "opa" do cidadão cai em handoff sem resposta
(diagnóstico com logs reais, 2026-06-18). Com o F16-S34, o backend passa a enviar `organization_id` no
request `/process/whatsapp/message`; este slot consome e propaga.

## Escopo (faz)

- `schemas/inbound.py` (`WhatsAppMessageRequest`): adicionar campo `organization_id: str` (uuid) e
  incluí-lo em `to_payload_dict()` (vai para o estado inicial).
- `state.py` (`ConversationState`): adicionar `organization_id` ao TypedDict do estado.
- `tools/leads_tools.py`: `get_or_create_lead` (e demais tools que escrevem — `update_lead_profile`)
  passam a aceitar `organization_id` e incluí-lo no `payload`.
- `nodes/identify_or_create_lead.py`: ler `organization_id` do state e repassar à tool.
- `nodes/persist_state.py`: incluir `organization_id` no body do `PUT /internal/conversations/:id/state`.
- `tools/audit_tools.py`: incluir `organization_id` no body do `POST /internal/ai/decisions`.
- Testes: atualizar mocks/fixtures para o novo campo; cobrir que cada chamada de escrita envia org_id.

## Fora de escopo (NÃO faz)

- Mudanças no backend Node (`apps/api/**`) — é o F16-S34.
- Implementar handoff via chatwoot no grafo (a chamada `/internal/chatwoot/notes` do node request_handoff
  é caminho legado; tratar o handoff do livechat é F16-S30, já mergeado — não reescrever aqui).
- Multi-tenancy real / resolução de org por outro meio — org vem do request (single-tenant por ora).

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/schemas/inbound.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/identify_or_create_lead.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/persist_state.py`
- `apps/langgraph-service/app/tools/leads_tools.py`
- `apps/langgraph-service/app/tools/audit_tools.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/langgraph-service/app/tools/_base.py` (cliente HTTP genérico — não precisa mudar)

## Contratos de entrada

- Request `/process/whatsapp/message` agora inclui `organization_id` (uuid) — F16-S34.
- Endpoints `/internal/*` exigem `organization_id` (uuid) no body.

## Contratos de saída

- Todas as chamadas de escrita do grafo enviam `organization_id` → 200/2xx em vez de 400.
- "saudacao" (primeiro contato) → lead criado (org+sem city) → grafo segue e responde o cidadão.

## Definition of Done

- [ ] `WhatsAppMessageRequest.organization_id` (uuid) + em `to_payload_dict()`
- [ ] `ConversationState.organization_id`
- [ ] `get_or_create_lead`, `persist_state` (PUT /state) e `log decision` (POST /ai/decisions) enviam org_id
- [ ] Nenhuma escrita /internal retorna 400 por org_id faltando (validado contra backend real)
- [ ] Testes verdes cobrindo org_id nas escritas
- [ ] `python -m pytest` + `ruff check app` verdes no serviço
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- `organization_id` NÃO é PII — pode aparecer em logs (diferente de phone/CPF/name).
- Fonte do org_id = o request do worker (F16-S34), propagado pelo estado inicial; NÃO inventar default
  nem ler de settings.
- O nó `load_state` (GET /state) não precisa de org_id (sem body) — não tocar.
- Validar de ponta a ponta: enviar uma saudação real e confirmar que o lead é criado (org + city null)
  e que o grafo gera resposta em vez de handoff.
