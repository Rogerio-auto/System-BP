---
id: F9-S03
title: LangGraph — endpoint dry-run (POST /process/whatsapp/playground)
phase: F9
task_ref: T9.3
status: review
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-05-19T22:10:10Z
completed_at: 2026-05-19T22:34:26Z
pr_url:
depends_on: [F3-S31, F3-S32]
blocks: [F9-S04]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/12-tasks-tecnicas.md
  - docs/17-lgpd-protecao-dados.md
---
# F9-S03 — LangGraph: endpoint dry-run de playground

## Objetivo

Expor o grafo `whatsapp_pre_attendance` em modo **dry-run** para o Console de IA: executa o grafo, devolve o trace + resposta, **sem persistir nada** em `ai_conversation_states`/`ai_decision_logs` e **sem chamar Chatwoot**.

## Escopo

- `apps/langgraph-service/app/api/playground.py` (novo) — rota `POST /process/whatsapp/playground`:
  - Mesmo `WhatsAppMessageRequest` de `process.py`, com `dry_run: Literal[True]` obrigatório no body (fail-fast se ausente — proteção contra confundir com endpoint de produção).
  - Exige `X-Internal-Token` (mesma dependência de `process.py`).
  - Roda `build_graph()` (re-utilizado de F3-S31), com um **`InternalApiClient` stub in-memory** injetado nos nós `persist_state` e `log_decision` para que essas operações não cheguem ao backend.
  - Coleta o `trace` (lista de `{ node, intent?, prompt_version?, model?, tokens_in?, tokens_out?, latency_ms?, dry_run: true }` por nó executado).
  - Response: `PlaygroundResponse` com `reply`, `trace`, `prompt_versions_used`, `tokens_total`, `latency_ms`, `errors`. **Não** retorna o estado completo da conversa.
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py` (novo) — fábrica do stub `InternalApiClient` (`DryRunInternalApiClient`) que:
  - Para `GET` retorna dados reais via um cliente delegado (contexto real é OK — leitura), OU pula chamadas se o operador não passou `lead_id`/`city_id` (modo sintético).
  - Para `POST/PATCH/PUT` (persist_state, log_decision, request_handoff, save_simulation, create_chatwoot_note etc.) **não** faz I/O — registra a chamada num sink in-memory que vai pro trace e retorna uma resposta sintética válida.
  - Marca todo log emitido com `dry_run: true`.
- `apps/langgraph-service/app/main.py` — registra `playground_router`.
- `apps/langgraph-service/tests/api/test_playground.py` — testa: (a) sem `dry_run: true` → 422; (b) com `X-Internal-Token` inválido → 401; (c) execução completa não cria nenhuma chamada de POST/PATCH ao backend stub (mock-count); (d) Chatwoot stub recebe 0 chamadas; (e) resposta inclui `trace` com nós percorridos.

## Contrato (Pydantic v2 estrito, `extra="forbid"`)

```
PlaygroundRequest:
  conversation_id: UUID  (sintético se não fornecido — auto-gerar prefixo "dry-")
  customer_phone: str (E.164)
  message_text: str  # passa por DLP no F9-S04 antes de chegar aqui — neste serviço, é assumido já mascarado
  lead_id: UUID | None  # contexto real opcional (leitura)
  city_id: UUID | None  # contexto real opcional (leitura)
  dry_run: Literal[True]  # OBRIGATÓRIO — fail-fast se ausente
  correlation_id: UUID
  organization_id: UUID

PlaygroundResponse:
  reply: ReplyPayload  # o que seria enviado ao usuário
  trace: list[NodeTraceEntry]
  prompt_versions_used: list[str]
  tokens_total: int
  latency_ms: int
  errors: list[dict[str, str]]  # já sanitizado (type/message/node)
```

## LGPD / Segurança

- **Nada persiste.** Validado por: `assert backend_mock.post.call_count == 0 and backend_mock.patch.call_count == 0` e equivalente para Chatwoot.
- O DLP da mensagem do operador é responsabilidade do **F9-S04** (proxy backend). Neste serviço, recebemos a mensagem já passada por `redact_pii` — mas como defesa adicional, aplicar `redact_pii` novamente em `receive_message` (operação idempotente sobre tokens já mascarados).
- Trace **não** contém o `message_text` cru — apenas IDs, intents, decisions sintetizadas, tokens.
- Rate limit próprio em `playground.py` (mais permissivo que produção — alvo: operador testando, não webhook).
- Label `lgpd-impact` no PR. Checklist §14.2 obrigatório.

## Fora de escopo

- Proxy backend (F9-S04). Frontend (F9-S07). Modo de comparar duas versões de prompt no mesmo run (`A/B test` — backlog).

## Arquivos permitidos

- `apps/langgraph-service/app/api/playground.py`
- `apps/langgraph-service/app/main.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py`
- `apps/langgraph-service/app/schemas/playground.py`
- `apps/langgraph-service/tests/api/test_playground.py`
- `apps/langgraph-service/tests/graphs/test_dry_run.py`

> Se a implementação exigir tocar nos nós `persist_state.py`/`log_decision.py` existentes para injeção limpa do client stub (em vez de monkey-patch), **pare e reporte** — abrimos um sub-slot de hardening da F3.

## Definition of Done

- [ ] Endpoint registrado, X-Internal-Token obrigatório, `dry_run: True` obrigatório.
- [ ] `DryRunInternalApiClient` implementado; mock-count confirma 0 POST/PATCH ao backend.
- [ ] 0 chamadas a Chatwoot durante dry-run, testado.
- [ ] Trace inclui `node`, `prompt_version`, `tokens` quando aplicável, `dry_run: true`.
- [ ] Schema Pydantic v2 `extra="forbid"`; payload desconhecido → 422.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
