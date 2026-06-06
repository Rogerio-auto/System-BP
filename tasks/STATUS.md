# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 22    | 0   | 0   | 0   | 0   | 0   | 22  |
| F1   | 28    | 0   | 0   | 0   | 0   | 0   | 28  |
| F10  | 15    | 1   | 3   | 0   | 1   | 0   | 10  |
| F2   | 11    | 0   | 0   | 0   | 0   | 0   | 11  |
| F3   | 38    | 0   | 0   | 0   | 0   | 0   | 38  |
| F4   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F5   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F7   | 8     | 0   | 0   | 0   | 0   | 0   | 8   |
| F8   | 18    | 0   | 0   | 0   | 0   | 0   | 18  |
| F9   | 12    | 0   | 0   | 0   | 0   | 0   | 12  |

## Fase 0 — Preparação

| ID      | Título                                                                                     | Status  | Prioridade | Depende de                     |
| ------- | ------------------------------------------------------------------------------------------ | ------- | ---------- | ------------------------------ |
| F0-S01  | Verificar e travar lockfiles (pnpm + python)                                               | ✅ done | critical   | —                              |
| F0-S02  | ESLint + Prettier — instalar e ligar nos workspaces                                        | ✅ done | high       | F0-S01                         |
| F0-S03  | Validar boot da API + healthcheck contra Postgres                                          | ✅ done | high       | F0-S01                         |
| F0-S03b | Upgrade fastify + vitest (CVE remediation)                                                 | ✅ done | high       | F0-S03                         |
| F0-S04  | Drizzle — primeira migration vazia + smoke test                                            | ✅ done | high       | F0-S01                         |
| F0-S05  | Web — dev server + design tokens + tela de login placeholder                               | ✅ done | medium     | F0-S01                         |
| F0-S06  | LangGraph service — boot + health + cliente HTTP base                                      | ✅ done | high       | F0-S01                         |
| F0-S07  | docker-compose — validação ponta a ponta                                                   | ✅ done | high       | F0-S03, F0-S04, F0-S05, F0-S06 |
| F0-S08  | Husky + lint-staged + commitlint                                                           | ✅ done | low        | F0-S02                         |
| F0-S10  | Fix scripts/slot.py claim/finish em worktrees do Agent tool                                | ✅ done | high       | —                              |
| F0-S11  | Investigar e corrigir bloco Validação dos slots F2 (Vitest vs Jest)                        | ✅ done | medium     | —                              |
| F0-S12  | Investigar staleness do Agent(isolation=worktree) vs commits recentes em main              | ✅ done | medium     | —                              |
| F0-S13  | Fix heurística de reconcile-merged (não detecta slots mergeados)                           | ✅ done | medium     | —                              |
| F0-S14  | Guard de sincronia entre migrations .sql e \_journal.json do Drizzle                       | ✅ done | high       | —                              |
| F0-S15  | Saneamento — restaurar typecheck e testes verdes da API                                    | ✅ done | high       | —                              |
| F0-S16  | Fix vitest + @fastify/autoload (forceESM) — env.js não resolve em integração               | ✅ done | high       | —                              |
| F0-S17  | Fix CI — shared-schemas typecheck (zod resolution + any implícito) + flaky rate-limit test | ✅ done | critical   | —                              |
| F0-S18  | Fix CI — langgraph Dockerfile não encontra uvicorn em runtime (4ª camada do destrava-CI)   | ✅ done | critical   | —                              |
| F0-S19  | Fix CI — alinhar env vars do langgraph no docker-compose.ci.yml (5ª camada)                | ✅ done | critical   | —                              |
| F0-S20  | Fix CI — db:migrate exige .env físico que CI não tem (6ª camada)                           | ✅ done | critical   | —                              |
| F0-S21  | Fix CI — migration 0041 sem `--> statement-breakpoint` (7ª e última camada)                | ✅ done | critical   | —                              |
| F0-S22  | Fix CI — testes E2E desatualizados em relação ao schema (8ª camada)                        | ✅ done | critical   | —                              |

## Fase 1 — Base operacional

| ID     | Título                                                                                  | Status  | Prioridade | Depende de                     |
| ------ | --------------------------------------------------------------------------------------- | ------- | ---------- | ------------------------------ |
| F1-S01 | Schema identidade — orgs, users, roles, permissions, sessions, city scopes              | ✅ done | critical   | F0-S04                         |
| F1-S02 | Helpers de erro e resposta padronizados                                                 | ✅ done | high       | F0-S03                         |
| F1-S03 | Auth — login, refresh, logout                                                           | ✅ done | critical   | F1-S01, F1-S02                 |
| F1-S04 | Middlewares authenticate + authorize com escopo de cidade                               | ✅ done | critical   | F1-S03                         |
| F1-S05 | Schema cities + agents + seed cidades de Rondônia                                       | ✅ done | high       | F1-S01                         |
| F1-S06 | CRUD cities (admin)                                                                     | ✅ done | medium     | F1-S04, F1-S05                 |
| F1-S07 | CRUD users + assign roles + city scopes                                                 | ✅ done | high       | F1-S04, F1-S05                 |
| F1-S08 | Frontend — login real + hook useAuth + layout autenticado                               | ✅ done | critical   | F1-S03, F0-S05                 |
| F1-S09 | Schema leads + customers + history + interactions                                       | ✅ done | critical   | F1-S01, F1-S05                 |
| F1-S10 | Helper de normalização de telefone (E.164 BR)                                           | ✅ done | high       | —                              |
| F1-S11 | CRUD leads (manual) com escopo de cidade + dedupe + eventos                             | ✅ done | critical   | F1-S04, F1-S09, F1-S10, F1-S15 |
| F1-S12 | Frontend CRM — lista + detalhe + form de lead                                           | ✅ done | high       | F1-S08, F1-S11                 |
| F1-S13 | Schema kanban + service de transições válidas                                           | ✅ done | high       | F1-S04, F1-S09                 |
| F1-S14 | Frontend Kanban (board + detalhe modal)                                                 | ✅ done | medium     | F1-S08, F1-S13                 |
| F1-S15 | Outbox — schema + emit() + worker outbox-publisher                                      | ✅ done | critical   | F0-S04                         |
| F1-S16 | Audit logs — schema + helper auditLog()                                                 | ✅ done | high       | F1-S01                         |
| F1-S17 | Pipeline de importação genérico (com adapter de leads)                                  | ✅ done | high       | F1-S11, F1-S15                 |
| F1-S18 | Frontend importação — wizard 4 passos                                                   | ✅ done | medium     | F1-S17                         |
| F1-S19 | Webhook WhatsApp — entrada + idempotência + persistência                                | ✅ done | high       | F1-S15                         |
| F1-S20 | Cliente HTTP Chatwoot                                                                   | ✅ done | medium     | F0-S03                         |
| F1-S21 | Webhook Chatwoot — entrada + idempotência                                               | ✅ done | medium     | F1-S20, F1-S15                 |
| F1-S22 | Sync de atributos do Chatwoot (handler de eventos)                                      | ✅ done | medium     | F1-S20, F1-S15, F1-S11         |
| F1-S23 | Feature flags — schema + admin UI + middleware backend + hook frontend                  | ✅ done | high       | F1-S04                         |
| F1-S24 | LGPD baseline — cifração de PII em coluna + hash HMAC + Pino redact                     | ✅ done | critical   | F1-S01, F1-S09                 |
| F1-S25 | LGPD — direitos do titular (acesso/portabilidade/revogação/correção) + jobs de retenção | ✅ done | high       | F1-S16, F1-S15, F1-S24         |
| F1-S26 | LGPD — DLP no pipeline LangGraph (mascaramento antes do gateway OpenRouter)             | ✅ done | critical   | F0-S06                         |
| F1-S27 | Fix encadeamento .using('gin') em schemas Drizzle (cities, leads)                       | ✅ done | critical   | —                              |
| F1-S28 | Fix typecheck do api — drizzle.config.ts fora de rootDir                                | ✅ done | critical   | F1-S27                         |

## Fase 10 —

| ID      | Título                                                                | Status         | Prioridade | Depende de       |
| ------- | --------------------------------------------------------------------- | -------------- | ---------- | ---------------- |
| F10-S01 | Pipeline MDX + componentes base (Callout, Step, CodeBlock)            | ✅ done        | high       | —                |
| F10-S02 | Layout 3-pane (nav + conteúdo + TOC) + filesystem-based nav           | ✅ done        | high       | F10-S01          |
| F10-S03 | Busca FlexSearch + Cmd+K palette global                               | ✅ done        | high       | F10-S02          |
| F10-S04 | Entry points — botão "?" na topbar + "Ajuda" no rodapé da sidebar     | ✅ done        | high       | F10-S03          |
| F10-S05 | Home da Central + 3 conceitos base (papéis, LGPD, módulos liberados)  | ✅ done        | high       | F10-S02          |
| F10-S06 | Getting started por papel — admin, gestor, agente                     | ✅ done        | high       | F10-S05          |
| F10-S07 | Guias CRM — criar lead, importar, kanban, detalhe, conversão, busca   | ✅ done        | high       | F10-S06          |
| F10-S08 | Guias Análise + Follow-up + Cobrança + Templates                      | ✅ done        | high       | F10-S07          |
| F10-S09 | fastify-zod-openapi + /openapi.json em todas as rotas                 | ✅ done        | high       | —                |
| F10-S10 | UI de API Reference 3-pane Stripe-like                                | 🔵 in-progress | medium     | F10-S09          |
| F10-S11 | Geração de páginas MDX da API + samples curl/TS                       | ⏸️ blocked     | medium     | F10-S09, F10-S10 |
| F10-S12 | Schema doc_views + doc_feedback + endpoints /api/help/\*              | ✅ done        | medium     | —                |
| F10-S13 | <FeedbackWidget /> + ranking de Populares na home                     | 🟢 available   | high       | F10-S12          |
| F10-S14 | Trava docs_required no template + atualiza agents e PROTOCOL          | ⏸️ blocked     | medium     | F10-S13          |
| F10-S15 | Template MDX canônico + meta-guia "Como escrever uma página de ajuda" | ⏸️ blocked     | low        | F10-S14          |

## Fase 2 — Crédito e simulação

| ID     | Título                                                                          | Status  | Prioridade | Depende de                     |
| ------ | ------------------------------------------------------------------------------- | ------- | ---------- | ------------------------------ |
| F2-S01 | Schema credit_products + product_rules + simulations + seed                     | ✅ done | critical   | F0-S04, F1-S09, F1-S13, F1-S15 |
| F2-S02 | Service de cálculo Price + SAC (puro, testável)                                 | ✅ done | high       | —                              |
| F2-S03 | CRUD credit-products + publicação versionada de regras                          | ✅ done | high       | F2-S01, F1-S04, F1-S15         |
| F2-S04 | Endpoint POST /api/simulations (UI)                                             | ✅ done | critical   | F2-S01, F2-S02, F2-S03, F1-S15 |
| F2-S05 | Endpoint POST /internal/simulations (para IA, idempotente)                      | ✅ done | high       | F2-S04                         |
| F2-S06 | Frontend simulador interno (form + resultado + amortização)                     | ✅ done | high       | F2-S04, F1-S08                 |
| F2-S07 | Frontend gestão de produtos + timeline de versões                               | ✅ done | medium     | F2-S03, F1-S08                 |
| F2-S08 | Frontend histórico de simulações na ficha do lead                               | ✅ done | medium     | F2-S04, F1-S12                 |
| F2-S09 | Worker kanban-on-simulation (consome simulations.generated)                     | ✅ done | medium     | F2-S04, F1-S13, F1-S15         |
| F2-S10 | Fix unidade monetária do simulador (centavos → reais)                           | ✅ done | critical   | —                              |
| F2-S11 | Alinhar contrato do simulador com o backend (request/response) + input numérico | ✅ done | high       | F2-S10                         |

## Fase 3 — Agentes IA

| ID     | Título                                                                      | Status  | Prioridade | Depende de                                                     |
| ------ | --------------------------------------------------------------------------- | ------- | ---------- | -------------------------------------------------------------- |
| F3-S00 | LLM Gateway — abstração OpenRouter + fallback Anthropic/OpenAI              | ✅ done | critical   | F0-S06                                                         |
| F3-S01 | Schema ai_conversation_states + ai_decision_logs + prompt_versions          | ✅ done | critical   | —                                                              |
| F3-S02 | Endpoints /internal/conversations/:id/state (load/save)                     | ✅ done | critical   | F3-S01, F3-S04                                                 |
| F3-S03 | Estado tipado ConversationState (Python)                                    | ✅ done | critical   | —                                                              |
| F3-S04 | Endpoint POST /internal/leads/get-or-create + plugin agregador /internal/\* | ✅ done | critical   | —                                                              |
| F3-S05 | Endpoint POST /internal/cities/identify (fuzzy match)                       | ✅ done | high       | F3-S04                                                         |
| F3-S06 | Endpoint GET /internal/credit-products                                      | ✅ done | high       | F3-S04                                                         |
| F3-S07 | Endpoint POST /internal/handoffs (request_handoff)                          | ✅ done | high       | F3-S04                                                         |
| F3-S08 | Endpoint POST /internal/chatwoot/notes (create_chatwoot_note)               | ✅ done | medium     | F3-S04                                                         |
| F3-S09 | Endpoint POST /internal/ai/decisions (log_ai_decision)                      | ✅ done | high       | F3-S01, F3-S04                                                 |
| F3-S10 | Endpoint GET /internal/customers/:id/context (get_customer_context)         | ✅ done | medium     | F3-S04                                                         |
| F3-S11 | Endpoint POST /internal/simulations/:id/sent (mark_simulation_sent)         | ✅ done | medium     | —                                                              |
| F3-S12 | Endpoint PATCH /internal/leads/:id (update_lead_profile)                    | ✅ done | medium     | F3-S04                                                         |
| F3-S13 | Tool get_or_create_lead (Python)                                            | ✅ done | high       | F3-S04                                                         |
| F3-S14 | Tool identify_city (Python)                                                 | ✅ done | high       | F3-S05                                                         |
| F3-S15 | Tool list_credit_products (Python)                                          | ✅ done | high       | F3-S06                                                         |
| F3-S16 | Tool generate_credit_simulation (Python)                                    | ✅ done | high       | F3-S15                                                         |
| F3-S17 | Tool request_handoff (Python)                                               | ✅ done | high       | F3-S07                                                         |
| F3-S18 | Tool create_chatwoot_note (Python)                                          | ✅ done | medium     | F3-S08, F3-S17                                                 |
| F3-S19 | Tool log_ai_decision (Python)                                               | ✅ done | high       | F3-S09                                                         |
| F3-S20 | Tool get_customer_context (Python)                                          | ✅ done | medium     | F3-S10, F3-S13                                                 |
| F3-S21 | Tool mark_simulation_sent (Python)                                          | ✅ done | medium     | F3-S11, F3-S15                                                 |
| F3-S22 | Tool update_lead_profile (Python)                                           | ✅ done | medium     | F3-S12, F3-S13                                                 |
| F3-S23 | Nó receive_message + load_conversation_state                                | ✅ done | high       | F3-S02, F3-S03                                                 |
| F3-S24 | Nó classify_intent (prompt versionado)                                      | ✅ done | high       | F3-S00, F3-S03                                                 |
| F3-S25 | Nó identify_or_create_lead + collect_missing_profile_data                   | ✅ done | high       | F3-S03, F3-S13                                                 |
| F3-S26 | Nó identify_city (com confirmação)                                          | ✅ done | high       | F3-S03, F3-S14, F3-S22                                         |
| F3-S27 | Nó qualify_credit_interest                                                  | ✅ done | high       | F3-S00, F3-S03                                                 |
| F3-S28 | Nós generate_simulation + save_simulation                                   | ✅ done | high       | F3-S00, F3-S03, F3-S15, F3-S16, F3-S21                         |
| F3-S29 | Nós decide_next_step + request_handoff                                      | ✅ done | high       | F3-S03, F3-S17, F3-S18                                         |
| F3-S30 | Nós send_response + persist_state + log_decision                            | ✅ done | high       | F3-S00, F3-S02, F3-S03, F3-S19                                 |
| F3-S31 | Edges + montagem do grafo whatsapp_pre_attendance                           | ✅ done | critical   | F3-S23, F3-S24, F3-S25, F3-S26, F3-S27, F3-S28, F3-S29, F3-S30 |
| F3-S32 | POST /process/whatsapp/message no LangGraph                                 | ✅ done | critical   | F3-S31                                                         |
| F3-S33 | Backend integra webhook WhatsApp → LangGraph → resposta                     | ✅ done | critical   | F3-S32                                                         |
| F3-S34 | Fallback de handoff em falha do LangGraph                                   | ✅ done | high       | F3-S07, F3-S33                                                 |
| F3-S35 | 5 fixtures conversacionais                                                  | ✅ done | high       | F3-S31                                                         |
| F3-S36 | Testes de prompt injection                                                  | ✅ done | high       | F3-S31                                                         |
| F3-S37 | Schema chatwoot_handoffs + persistência no endpoint de handoff              | ✅ done | high       | F3-S01, F3-S07                                                 |

## Fase 4 — Atendimento WhatsApp + Chatwoot

| ID     | Título                                                                               | Status  | Prioridade | Depende de                             |
| ------ | ------------------------------------------------------------------------------------ | ------- | ---------- | -------------------------------------- |
| F4-S01 | Schema credit_analyses + credit_analysis_versions + migration                        | ✅ done | critical   | F2-S01, F1-S09, F1-S13, F1-S15, F1-S24 |
| F4-S02 | Backend — service + endpoints CRUD de credit_analyses (RBAC + Art. 20)               | ✅ done | critical   | F4-S01, F1-S04, F1-S15, F1-S16         |
| F4-S03 | Frontend — lista, detalhe, form e nova versão de análise de crédito                  | ✅ done | high       | F4-S02, F1-S08, F1-S12, F8-S08         |
| F4-S04 | Tool LangGraph get_credit_analysis_history (read-only mascarado)                     | ✅ done | high       | F4-S02, F3-S04, F1-S26                 |
| F4-S05 | Worker kanban-on-analysis — promoção aprova/recusa move o card                       | ✅ done | high       | F4-S02, F1-S13, F1-S15, F2-S09         |
| F4-S06 | Adapter de importação de análises de crédito                                         | ✅ done | medium     | F4-S02, F1-S17, F1-S18                 |
| F4-S07 | Fix sidebar drift — remove /analise placeholder e faz Sidebar consumir navigation.ts | ✅ done | medium     | —                                      |

## Fase 5 — Follow-up e cobrança

| ID     | Título                                                            | Status  | Prioridade | Depende de                                     |
| ------ | ----------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------- |
| F5-S01 | Schema followup_rules + followup_jobs + whatsapp_templates        | ✅ done | high       | F0-S04, F1-S09, F1-S15, F1-S23                 |
| F5-S02 | Worker followup-scheduler (gated)                                 | ✅ done | high       | F5-S01, F1-S15, F1-S23                         |
| F5-S03 | Worker followup-sender + cliente Meta WhatsApp templates          | ✅ done | high       | F5-S01, F5-S02, F1-S15, F1-S20                 |
| F5-S04 | Cancelamento de followup por resposta do cliente                  | ✅ done | high       | F5-S01, F5-S03, F1-S19, F1-S15                 |
| F5-S05 | Frontend — réguas de followup, jobs agendados e pausa manual      | ✅ done | medium     | F5-S01, F5-S02, F5-S03, F1-S08, F1-S23, F8-S08 |
| F5-S06 | Schema payment_dues + collection_rules + collection_jobs          | ✅ done | medium     | F5-S01, F1-S09, F1-S15, F1-S23, F1-S24         |
| F5-S07 | Workers collection-scheduler + collection-sender (gated)          | ✅ done | medium     | F5-S06, F5-S03, F1-S15                         |
| F5-S08 | Frontend cobrança + importação payment_dues + marcação manual     | ✅ done | medium     | F5-S06, F5-S07, F1-S08, F1-S17, F8-S08         |
| F5-S09 | Frontend templates WhatsApp + sync Meta Cloud + webhook de status | ✅ done | medium     | F5-S01, F5-S03, F1-S08, F1-S20, F8-S08         |

## Fase 7 — Hardening final

| ID     | Título                                                                               | Status  | Prioridade | Depende de                                     |
| ------ | ------------------------------------------------------------------------------------ | ------- | ---------- | ---------------------------------------------- |
| F7-S01 | Configurar Kimi K2 como modelo default do reasoner LangGraph                         | ✅ done | critical   | F3-S00, F9-S00                                 |
| F7-S02 | CI — E2E smoke test (docker-compose + fluxo crítico)                                 | ✅ done | critical   | F3-S33, F3-S34                                 |
| F7-S03 | Hardening F3 pré-produção (timing-safe token, multi-tenant scope, idempotency, logs) | ✅ done | critical   | F3-S33, F3-S34, F9-S10                         |
| F7-S04 | Adapter de importação Notion → leads + lead_history                                  | ✅ done | high       | F1-S17, F1-S18, F1-S24                         |
| F7-S06 | Runbook de go-live + observabilidade pré-prod                                        | ✅ done | high       | F7-S01, F7-S02, F7-S03                         |
| F7-S07 | Importação em staging + conferência paralela com Notion                              | ✅ done | high       | F4-S06, F7-S04, F7-S06                         |
| F7-S08 | Treinamento dos agentes humanos + material de apoio                                  | ✅ done | medium     | F7-S06                                         |
| F7-S09 | Cutover, go-live e monitoramento das primeiras 168h                                  | ✅ done | critical   | F7-S01, F7-S02, F7-S03, F7-S06, F7-S07, F7-S08 |

## Fase 8 —

| ID     | Título                                                                                        | Status  | Prioridade | Depende de                     |
| ------ | --------------------------------------------------------------------------------------------- | ------- | ---------- | ------------------------------ |
| F8-S01 | Backend CRUD agents + agent_cities (admin)                                                    | ✅ done | high       | F1-S04, F1-S05, F1-S07         |
| F8-S02 | Frontend gestão de usuários (admin/users)                                                     | ✅ done | high       | F1-S07, F1-S08                 |
| F8-S03 | Backend endpoint /api/dashboard/metrics (KPIs agregados)                                      | ✅ done | medium     | F1-S04, F1-S09, F1-S11, F1-S13 |
| F8-S04 | Frontend gestão de agentes de crédito                                                         | ✅ done | high       | F8-S01, F1-S08                 |
| F8-S05 | Frontend dashboard real com KPIs e gráficos                                                   | ✅ done | medium     | F8-S03, F1-S08                 |
| F8-S06 | Backend — GET /api/admin/roles + roles na listagem de usuários                                | ✅ done | high       | —                              |
| F8-S07 | Promover roles.scope a coluna real (migration + backfill) e ler do banco                      | ✅ done | medium     | F8-S06                         |
| F8-S08 | Frontend — Hub de Configurações + reorganização da Administração                              | ✅ done | medium     | —                              |
| F8-S09 | Conta — self-service de perfil, senha e aparência (backend + frontend)                        | ✅ done | medium     | F8-S08                         |
| F8-S10 | Reconciliação RBAC — padronizar permissões em :manage                                         | ✅ done | medium     | —                              |
| F8-S11 | 2FA / TOTP — enrolment, verificação, recovery codes e enforcement no login                    | ✅ done | medium     | F8-S09                         |
| F8-S12 | Fix /admin/users — drawer transparente, kebab clipado, roles vazias, seed sem credit_analyses | ✅ done | high       | —                              |
| F8-S13 | Fix seed.ts ROLES sem scope — quebra db:seed pós-migration 0021                               | ✅ done | high       | —                              |
| F8-S14 | Substituir inputs de UUID por comboboxes com busca (lead, cidade, simulação)                  | ✅ done | high       | —                              |
| F8-S15 | Fix loop infinito em SimulationSelect (regressão F8-S14)                                      | ✅ done | high       | —                              |
| F8-S16 | Fix 500 em GET /api/leads?search (regressão F8-S14)                                           | ✅ done | high       | —                              |
| F8-S17 | Fix migrator Drizzle — `CREATE INDEX CONCURRENTLY` falha silenciosamente em transação         | ✅ done | high       | —                              |
| F8-S18 | Frontend — plugar Cobrança + Templates WhatsApp no Hub de Configurações                       | ✅ done | high       | —                              |

## Fase 9 —

| ID     | Título                                                                          | Status  | Prioridade | Depende de             |
| ------ | ------------------------------------------------------------------------------- | ------- | ---------- | ---------------------- |
| F9-S00 | Schema model_pricing — preços por modelo LLM (USD) + FX para BRL                | ✅ done | high       | —                      |
| F9-S01 | Backend — API de prompt_versions (CRUD + ativação transacional)                 | ✅ done | high       | F3-S01, F1-S04, F1-S16 |
| F9-S02 | Backend — API read de ai_decision_logs (lista + timeline, city-scoped)          | ✅ done | high       | F3-S01, F9-S00, F1-S04 |
| F9-S03 | LangGraph — endpoint dry-run (POST /process/whatsapp/playground)                | ✅ done | high       | F3-S31, F3-S32         |
| F9-S04 | Backend — proxy /api/ai-console/playground + DLP na entrada do operador         | ✅ done | high       | F9-S03, F3-S33         |
| F9-S05 | Frontend — gestão de prompts (editor + preview markdown + diff + ativação)      | ✅ done | high       | F9-S01, F8-S08, F1-S08 |
| F9-S06 | Frontend — visualizador de ai_decision_logs (lista + timeline por conversa)     | ✅ done | high       | F9-S02, F8-S08, F1-S08 |
| F9-S07 | Frontend — playground (com contexto real opcional + DRY-RUN banner)             | ✅ done | high       | F9-S04, F8-S08, F1-S08 |
| F9-S08 | Parametrização de modelo no editor de prompts — temperature, max_tokens, top_p  | ✅ done | medium     | F9-S01, F9-S05, F3-S00 |
| F9-S09 | LangGraph lê prompts de prompt_versions (DB) em vez de arquivos .md             | ✅ done | high       | F9-S01, F9-S08         |
| F9-S10 | Hardening do runtime do agente — DLP gateway + dry_run_sink + mensagens de erro | ✅ done | critical   | F3-S24, F9-S03         |
| F9-S11 | Fix dry-run GET /internal/conversations/:id/state — retorna shape errado        | ✅ done | high       | —                      |
