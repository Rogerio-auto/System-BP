# Fase 3 — LangGraph + agente externo

> **Slots materializados em 2026-05-18** a partir do esboço original, de
> `docs/06-langgraph-agentes.md` e `docs/12-tasks-tecnicas.md` T3.1–T3.21.
> Pré-condição (F2 concluída) cumprida.

## Decisões de materialização

- **Endpoint + Tool separados.** O esboço original juntava endpoint Node + tool
  Python num slot só (`S04`–`S13`). Como os subagentes são estritamente separados
  (`backend-engineer` = Node, `python-engineer` = Python), cada par virou 2 slots:
  o endpoint interno e a tool, com a tool dependendo do endpoint.
- **`generate_credit_simulation` — endpoint já existe.** `POST /internal/simulations`
  foi entregue em **F2-S05** (done). Só o lado Python (`F3-S16`) foi criado.
- **Infra já pronta, sem slot:** cliente HTTP `tools/_base.py` (T3.3) e DLP
  (`app/llm/dlp.py`) já existem — reaproveitados, não recriados.
- **Plugin agregador `/internal/*`:** criado em `F3-S04` com `@fastify/autoload`
  apontando para `modules/internal/*/routes.ts`. Os demais endpoints internos
  (`F3-S02`, `S05`–`S12`) só criam o próprio `modules/internal/<domínio>/routes.ts`
  — nenhum arquivo compartilhado é editado, então rodam 100% em paralelo após `S04`.

## Slots

| ID     | Título                                                                 | Specialist         | Status    |
| ------ | ---------------------------------------------------------------------- | ------------------ | --------- |
| F3-S00 | LLM Gateway (OpenRouter + fallback)                                    | python-engineer    | ✅ done   |
| F3-S01 | Schema ai_conversation_states + ai_decision_logs + prompt_versions     | db-schema-engineer | available |
| F3-S02 | Endpoints /internal/conversations/:id/state (load/save)                | backend-engineer   | available |
| F3-S03 | Estado tipado ConversationState (Python)                               | python-engineer    | available |
| F3-S04 | Endpoint /internal/leads/get-or-create + plugin agregador /internal/\* | backend-engineer   | available |
| F3-S05 | Endpoint POST /internal/cities/identify (fuzzy)                        | backend-engineer   | available |
| F3-S06 | Endpoint GET /internal/credit-products                                 | backend-engineer   | available |
| F3-S07 | Endpoint POST /internal/handoffs                                       | backend-engineer   | available |
| F3-S08 | Endpoint POST /internal/chatwoot/notes                                 | backend-engineer   | available |
| F3-S09 | Endpoint POST /internal/ai/decisions                                   | backend-engineer   | available |
| F3-S10 | Endpoint GET /internal/customers/:id/context                           | backend-engineer   | available |
| F3-S11 | Endpoint POST /internal/simulations/:id/sent                           | backend-engineer   | available |
| F3-S12 | Endpoint PATCH /internal/leads/:id (update_lead_profile)               | backend-engineer   | available |
| F3-S13 | Tool get_or_create_lead                                                | python-engineer    | available |
| F3-S14 | Tool identify_city                                                     | python-engineer    | available |
| F3-S15 | Tool list_credit_products                                              | python-engineer    | available |
| F3-S16 | Tool generate_credit_simulation                                        | python-engineer    | available |
| F3-S17 | Tool request_handoff                                                   | python-engineer    | available |
| F3-S18 | Tool create_chatwoot_note                                              | python-engineer    | available |
| F3-S19 | Tool log_ai_decision                                                   | python-engineer    | available |
| F3-S20 | Tool get_customer_context                                              | python-engineer    | available |
| F3-S21 | Tool mark_simulation_sent                                              | python-engineer    | available |
| F3-S22 | Tool update_lead_profile                                               | python-engineer    | available |
| F3-S23 | Nós receive_message + load_conversation_state                          | python-engineer    | available |
| F3-S24 | Nó classify_intent (prompt versionado)                                 | python-engineer    | available |
| F3-S25 | Nós identify_or_create_lead + collect_missing_profile                  | python-engineer    | available |
| F3-S26 | Nó identify_city (com confirmação)                                     | python-engineer    | available |
| F3-S27 | Nó qualify_credit_interest                                             | python-engineer    | available |
| F3-S28 | Nós generate_simulation + save_simulation                              | python-engineer    | available |
| F3-S29 | Nós decide_next_step + request_handoff                                 | python-engineer    | available |
| F3-S30 | Nós send_response + persist_state + log_decision                       | python-engineer    | available |
| F3-S31 | Edges + montagem do grafo whatsapp_pre_attendance                      | python-engineer    | available |
| F3-S32 | POST /process/whatsapp/message no LangGraph                            | python-engineer    | available |
| F3-S33 | Backend integra webhook → LangGraph → resposta                         | backend-engineer   | available |
| F3-S34 | Fallback de handoff em falha do LangGraph                              | backend-engineer   | available |
| F3-S35 | 5 fixtures conversacionais                                             | qa-tester          | available |
| F3-S36 | Testes de prompt injection                                             | qa-tester          | available |

## Ordem de execução sugerida

1. **Onda 1 (paraleliza, 0 colisão):** `F3-S01` (schema), `F3-S03` (estado Python),
   `F3-S04` (endpoint + plugin agregador) e `F3-S11` (endpoint em `modules/simulations`,
   independente do agregador).
2. **Onda 2 — endpoints internos:** `F3-S05`–`S10`, `S12` (todos dependem de `S04`);
   `F3-S02`/`S09` também dependem de `S01`. Sem colisão entre si (autoload).
3. **Onda 3 — tools:** cada `F3-S13…S22` depende do seu endpoint.
4. **Onda 4 — nós:** `F3-S23…S30`, dependem do estado (S03), das tools e do gateway.
5. **Onda 5 — grafo:** `F3-S31` (precisa dos 8 nós), depois `F3-S32`.
6. **Onda 6 — integração + testes:** `F3-S33` → `F3-S34`; `F3-S35` e `F3-S36` após `S31`.
