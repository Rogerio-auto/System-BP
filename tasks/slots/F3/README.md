# Fase 3 — LangGraph + agente externo

> Slots desta fase serão criados quando F2 estiver concluída.
> Origem: [docs/06-langgraph-agentes.md](../../../docs/06-langgraph-agentes.md) + [docs/12-tasks-tecnicas.md](../../../docs/12-tasks-tecnicas.md) T3.1–T3.21.

Esboço — cada tool e cada nó vira um slot independente para paralelismo máximo:

| ID provisório | Título |
|---|---|
| F3-S00 | **LLM Gateway (OpenRouter + fallback)** ✅ slot pronto |
| F3-S01 | Schema ai_conversation_states + ai_decision_logs + prompt_versions |
| F3-S02 | Endpoint /internal/conversations/:id/state (load/save) |
| F3-S03 | Estado tipado ConversationState (Python) |
| F3-S04 | Endpoint + Tool: get_or_create_lead |
| F3-S05 | Endpoint + Tool: identify_city (fuzzy) |
| F3-S06 | Endpoint + Tool: list_credit_products |
| F3-S07 | Endpoint + Tool: generate_credit_simulation |
| F3-S08 | Endpoint + Tool: request_handoff |
| F3-S09 | Endpoint + Tool: create_chatwoot_note |
| F3-S10 | Endpoint + Tool: log_ai_decision |
| F3-S11 | Endpoint + Tool: get_customer_context |
| F3-S12 | Endpoint + Tool: mark_simulation_sent |
| F3-S13 | Endpoint + Tool: update_lead_profile |
| F3-S14 | Nó receive_message + load_state |
| F3-S15 | Nó classify_intent (com prompt versionado) |
| F3-S16 | Nó identify_or_create_lead |
| F3-S17 | Nó identify_city (com confirmação) |
| F3-S18 | Nó qualify_credit_interest |
| F3-S19 | Nó generate_simulation + save_simulation |
| F3-S20 | Nó decide_next_step + request_handoff |
| F3-S21 | Nó send_response + persist_state + log_decision |
| F3-S22 | Edges + montagem do grafo whatsapp_pre_attendance |
| F3-S23 | POST /process/whatsapp/message no LangGraph |
| F3-S24 | Backend integra webhook → LangGraph → resposta |
| F3-S25 | Fallback de handoff em falha do LangGraph |
| F3-S26 | 5 fixtures conversacionais |
| F3-S27 | Testes de prompt injection |
