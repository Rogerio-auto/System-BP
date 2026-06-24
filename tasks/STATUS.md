# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 22    | 0   | 0   | 0   | 0   | 0   | 22  |
| F1   | 28    | 0   | 0   | 0   | 0   | 0   | 28  |
| F10  | 15    | 0   | 0   | 0   | 0   | 0   | 15  |
| F12  | 13    | 0   | 0   | 0   | 0   | 0   | 13  |
| F13  | 8     | 0   | 0   | 0   | 0   | 0   | 8   |
| F14  | 6     | 0   | 0   | 0   | 0   | 0   | 6   |
| F15  | 12    | 0   | 1   | 0   | 0   | 0   | 11  |
| F16  | 51    | 1   | 0   | 0   | 0   | 0   | 50  |
| F17  | 14    | 0   | 0   | 0   | 0   | 0   | 14  |
| F18  | 12    | 0   | 0   | 0   | 0   | 0   | 12  |
| F19  | 6     | 0   | 0   | 0   | 0   | 0   | 6   |
| F2   | 11    | 0   | 0   | 0   | 0   | 0   | 11  |
| F20  | 8     | 0   | 0   | 0   | 0   | 0   | 8   |
| F21  | 4     | 0   | 0   | 0   | 0   | 0   | 4   |
| F22  | 3     | 0   | 0   | 0   | 0   | 0   | 3   |
| F23  | 11    | 0   | 0   | 0   | 0   | 1   | 10  |
| F3   | 38    | 0   | 0   | 0   | 0   | 0   | 38  |
| F4   | 7     | 0   | 0   | 0   | 0   | 0   | 7   |
| F5   | 16    | 0   | 0   | 0   | 0   | 0   | 16  |
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

| ID      | Título                                                                | Status  | Prioridade | Depende de       |
| ------- | --------------------------------------------------------------------- | ------- | ---------- | ---------------- |
| F10-S01 | Pipeline MDX + componentes base (Callout, Step, CodeBlock)            | ✅ done | high       | —                |
| F10-S02 | Layout 3-pane (nav + conteúdo + TOC) + filesystem-based nav           | ✅ done | high       | F10-S01          |
| F10-S03 | Busca FlexSearch + Cmd+K palette global                               | ✅ done | high       | F10-S02          |
| F10-S04 | Entry points — botão "?" na topbar + "Ajuda" no rodapé da sidebar     | ✅ done | high       | F10-S03          |
| F10-S05 | Home da Central + 3 conceitos base (papéis, LGPD, módulos liberados)  | ✅ done | high       | F10-S02          |
| F10-S06 | Getting started por papel — admin, gestor, agente                     | ✅ done | high       | F10-S05          |
| F10-S07 | Guias CRM — criar lead, importar, kanban, detalhe, conversão, busca   | ✅ done | high       | F10-S06          |
| F10-S08 | Guias Análise + Follow-up + Cobrança + Templates                      | ✅ done | high       | F10-S07          |
| F10-S09 | fastify-zod-openapi + /openapi.json em todas as rotas                 | ✅ done | high       | —                |
| F10-S10 | UI de API Reference 3-pane Stripe-like                                | ✅ done | medium     | F10-S09          |
| F10-S11 | Geração de páginas MDX da API + samples curl/TS                       | ✅ done | medium     | F10-S09, F10-S10 |
| F10-S12 | Schema doc_views + doc_feedback + endpoints /api/help/\*              | ✅ done | medium     | —                |
| F10-S13 | <FeedbackWidget /> + ranking de Populares na home                     | ✅ done | high       | F10-S12          |
| F10-S14 | Trava docs_required no template + atualiza agents e PROTOCOL          | ✅ done | medium     | F10-S13          |
| F10-S15 | Template MDX canônico + meta-guia "Como escrever uma página de ajuda" | ✅ done | low        | F10-S14          |

## Fase 12 —

| ID      | Título                                                                                  | Status  | Prioridade | Depende de       |
| ------- | --------------------------------------------------------------------------------------- | ------- | ---------- | ---------------- |
| F12-S01 | Schema feature_tutorials + migration + catálogo de feature_key                          | ✅ done | medium     | —                |
| F12-S02 | API /api/help/tutorials + /api/admin/tutorials CRUD + RBAC                              | ✅ done | medium     | F12-S01          |
| F12-S03 | Componente <VideoTutorial> provider-aware + registro no MDX                             | ✅ done | medium     | —                |
| F12-S04 | <ContextualHelp> + Drawer global de ajuda contextual                                    | ✅ done | medium     | F12-S02, F12-S03 |
| F12-S05 | Admin /admin/tutoriais (CRUD de tutoriais)                                              | ✅ done | medium     | F12-S02, F12-S03 |
| F12-S06 | Instrumentar telas do app com <ContextualHelp featureKey>                               | ✅ done | low        | F12-S04, F12-S05 |
| F12-S07 | Telemetria de adoção de tutoriais (opened/completed) — fase 2                           | ✅ done | low        | F12-S02          |
| F12-S08 | Completar data model — duration_seconds (schema + migration + API)                      | ✅ done | low        | F12-S01, F12-S02 |
| F12-S09 | Semear feature flag tutorials.enabled                                                   | ✅ done | medium     | F12-S02          |
| F12-S10 | Fix — wirar rota /admin/tutoriais e card na ConfiguracoesPage (regressão F12-S05)       | ✅ done | high       | F12-S05          |
| F12-S11 | Fix CRÍTICO — runner de migrations pula migrations em DB existente (go-live blocker)    | ✅ done | critical   | —                |
| F12-S12 | Fix — alinhar cliente admin de tutoriais ao contrato real da API (400/erro ao carregar) | ✅ done | critical   | F12-S05          |
| F12-S13 | Fix — Callout crasha a página com type inválido (white-screen no help)                  | ✅ done | high       | —                |

## Fase 13 —

| ID      | Título                                                                  | Status  | Prioridade | Depende de |
| ------- | ----------------------------------------------------------------------- | ------- | ---------- | ---------- |
| F13-S01 | CurrencyInput canônico + helpers de moeda (BRL)                         | ✅ done | high       | —          |
| F13-S02 | Aplicar CurrencyInput nas telas de valor + corrigir bug ×10             | ✅ done | high       | F13-S01    |
| F13-S03 | CRM exibe cidade + estágio de Kanban (lista, ficha e card)              | ✅ done | high       | —          |
| F13-S04 | Follow-up — segmentar por estágio e outcome no frontend                 | ✅ done | medium     | —          |
| F13-S05 | Dashboard — tempo médio por estágio de Kanban                           | ✅ done | medium     | —          |
| F13-S06 | Produto de crédito — ativar/usar versão de regra                        | ✅ done | medium     | —          |
| F13-S07 | Endpoints de timeline — interactions do lead + histórico do card Kanban | ✅ done | high       | —          |
| F13-S08 | Estados de erro/empty no CRM+Kanban + gating do sync-all de templates   | ✅ done | high       | F13-S07    |

## Fase 14 —

| ID      | Título                                                                         | Status  | Prioridade | Depende de |
| ------- | ------------------------------------------------------------------------------ | ------- | ---------- | ---------- |
| F14-S01 | Schema — lead PJ (CNPJ/razão social) + índice único de email                   | ✅ done | high       | —          |
| F14-S02 | Backend — lead PJ + email obrigatório no manual + unicidade + bloqueio interno | ✅ done | high       | F14-S01    |
| F14-S03 | Frontend — NewLeadModal com PJ + email obrigatório                             | ✅ done | high       | F14-S02    |
| F14-S04 | Email pessoal do agente no 1º login + bloqueio estendido                       | ✅ done | medium     | F14-S02    |
| F14-S05 | Backend — disparo de simulação por WhatsApp                                    | ✅ done | high       | —          |
| F14-S06 | Frontend — botão "Enviar simulação ao cliente"                                 | ✅ done | high       | F14-S05    |

## Fase 15 —

| ID      | Título                                                                          | Status     | Prioridade | Depende de                         |
| ------- | ------------------------------------------------------------------------------- | ---------- | ---------- | ---------------------------------- |
| F15-S01 | Schema — role `cobranca` global + permissões de cobrança/tarefas/notificações   | ✅ done    | high       | —                                  |
| F15-S02 | Schema — status SPC dedicado em `customers`                                     | ✅ done    | high       | —                                  |
| F15-S03 | Schema — tabelas `tasks`, `notifications`, `notification_preferences`           | ✅ done    | high       | —                                  |
| F15-S04 | Contratos compartilhados — tarefas, notificações, SPC, dashboard cobrança       | ✅ done    | high       | F15-S03                            |
| F15-S05 | Backend — módulo de tarefas (CRUD + assumir + concluir + "minhas tarefas")      | ✅ done    | high       | F15-S01, F15-S03, F15-S04          |
| F15-S06 | Backend — notificações in-app + fan-out por canal (email/WhatsApp)              | ✅ done    | high       | F15-S01, F15-S03, F15-S04, F15-S05 |
| F15-S07 | Backend — service de status SPC (transições + auditoria)                        | ✅ done    | medium     | F15-S01, F15-S02, F15-S04          |
| F15-S08 | Backend — worker de inadimplência 15d → cria tarefa SPC + evento de notificação | ✅ done    | medium     | F15-S05, F15-S06, F15-S07          |
| F15-S09 | Backend — métricas do dashboard de cobrança                                     | ✅ done    | medium     | F15-S01, F15-S02, F15-S04          |
| F15-S10 | Frontend — painel de tarefas + badge de notificações no header                  | ✅ done    | high       | F15-S04, F15-S05, F15-S06          |
| F15-S11 | Frontend — dashboard de cobrança + tag/ação de SPC                              | ✅ done    | medium     | F15-S04, F15-S07, F15-S09          |
| F15-S12 | Importar relatório de baixa — conciliação CPF + nº da parcela (BLOCKED — D10)   | ⏸️ blocked | medium     | —                                  |

## Fase 16 —

| ID      | Título                                                                                              | Status       | Prioridade | Depende de                         |
| ------- | --------------------------------------------------------------------------------------------------- | ------------ | ---------- | ---------------------------------- |
| F16-S01 | Infra base do live chat — Redis + RabbitMQ + R2 (clientes + topologia de filas)                     | ✅ done      | critical   | —                                  |
| F16-S02 | Schema multicanal do live chat — channels, channel_secrets, conversations, messages, webhook_events | ✅ done      | critical   | —                                  |
| F16-S03 | Contratos compartilhados do live chat — discriminated unions + Zod + socket events                  | ✅ done      | critical   | —                                  |
| F16-S04 | packages/channels core — IChannelAdapter, graphClient, hmac por-canal, errors                       | ✅ done      | high       | F16-S02, F16-S03                   |
| F16-S05 | Adapter Meta WhatsApp — webhook.parser + serializer + adapter + códigos de erro WA                  | ✅ done      | high       | F16-S04                            |
| F16-S06 | Webhook Meta (Fastify) — verify por-app, HMAC por-canal, dedup, publish inbound                     | ✅ done      | high       | F16-S02, F16-S03, F16-S04          |
| F16-S07 | Domínio livechat — repository + service de persistência (contact/conversation/message + janela)     | ✅ done      | high       | F16-S02, F16-S03                   |
| F16-S08 | Worker inbound — consome fila, parseia, persiste e publica socket relay                             | ✅ done      | high       | F16-S01, F16-S05, F16-S06, F16-S07 |
| F16-S09 | Worker media — download via adapter, dedup SHA-256, upload R2, media_ready                          | ✅ done      | medium     | F16-S01, F16-S05, F16-S07          |
| F16-S10 | Worker outbound — FIFO lock por conversa, dispatch por provider, send, view_status                  | ✅ done      | high       | F16-S01, F16-S05, F16-S07          |
| F16-S11 | Canais — connect manual (provider-discriminado, segredo cifrado) + list                             | ✅ done      | high       | F16-S02, F16-S03, F16-S04          |
| F16-S12 | API conversas (read) — list, get, messages (cursor), window state                                   | ✅ done      | high       | F16-S03, F16-S07                   |
| F16-S13 | API envio de mensagem — valida janela 24h, idempotência, signed-url, enfileira outbound             | ✅ done      | high       | F16-S07, F16-S10, F16-S12          |
| F16-S14 | Socket server + relay — Socket.io no Fastify, auth, rooms, consumo de socket.relay                  | ✅ done      | medium     | F16-S01, F16-S03, F16-S07          |
| F16-S15 | Web — camada de dados + realtime (queries, types, SocketProvider, rota)                             | ✅ done      | high       | F16-S03, F16-S12, F16-S14          |
| F16-S16 | Web — Inbox: layout 3 colunas + ChatList (filtros, busca, scroll infinito, realtime)                | ✅ done      | high       | F16-S15                            |
| F16-S17 | Web — Conversa: MessageBubble (todos os tipos) + Composer + envio + janela 24h                      | ✅ done      | high       | F16-S15, F16-S13                   |
| F16-S18 | Composer — upload de mídia (imagem, vídeo, documento, áudio)                                        | ✅ done      | high       | F16-S13, F16-S17                   |
| F16-S19 | Composer — seletor de template (janela 24h expirada)                                                | ✅ done      | high       | F16-S13, F16-S17                   |
| F16-S20 | Composer — emoji picker                                                                             | ✅ done      | medium     | F16-S17                            |
| F16-S21 | Composer — gravação de áudio PTT (push-to-talk)                                                     | ✅ done      | medium     | F16-S18                            |
| F16-S22 | Inbound dedupe-and-link contato→lead + flag auto-lead                                               | ✅ done      | high       | F16-S07, F16-S08                   |
| F16-S23 | API vincular/criar lead da conversa (1-clique manual)                                               | ✅ done      | high       | F16-S22                            |
| F16-S24 | Painel de contato — vínculo de lead e ação criar lead                                               | ✅ done      | high       | F16-S23                            |
| F16-S25 | Ligar tempo real — registrar socketPlugin + startSocketRelay no boot                                | ✅ done      | critical   | —                                  |
| F16-S26 | Conversations backend — read emite conversation:updated + PATCH /lead aceita cityId                 | ✅ done      | high       | F16-S25                            |
| F16-S27 | Front livechat — badge em tempo real, marcar lida ao abrir e Criar lead com cidade                  | ✅ done      | high       | F16-S25, F16-S26                   |
| F16-S28 | IA no livechat — gate (flag + allowlist de teste) e trigger no inbound                              | ✅ done      | high       | —                                  |
| F16-S29 | Worker livechat-ai — LangGraph responde no livechat via send service                                | ✅ done      | high       | F16-S28                            |
| F16-S30 | Handoff real + mensagem de fallback ao cidadão quando a IA falha                                    | ✅ done      | high       | F16-S29                            |
| F16-S31 | UI livechat — bubble/composer responsivos sem espremer + scrollbar custom                           | ✅ done      | medium     | —                                  |
| F16-S32 | Permitir criar lead sem city_id no canal IA (remover guard obsoleto)                                | ✅ done      | critical   | —                                  |
| F16-S33 | Timeout do grafo configurável por env (GRAPH_TIMEOUT_SEC)                                           | ✅ done      | medium     | —                                  |
| F16-S34 | Worker livechat-ai envia organization_id no request ao LangGraph                                    | ✅ done      | critical   | —                                  |
| F16-S35 | LangGraph propaga organization_id em todas as chamadas /internal de escrita                         | ✅ done      | critical   | F16-S34                            |
| F16-S36 | load_state preserva organization_id (não descartar no merge)                                        | ✅ done      | critical   | —                                  |
| F16-S37 | receive_message extrai organization_id do payload (estado inicial)                                  | ✅ done      | critical   | —                                  |
| F16-S38 | Sweep org_id — todas as escritas /internal do LangGraph (cities, handoffs, persist, decisions)      | ✅ done      | critical   | —                                  |
| F16-S39 | Seed do prompt do agente Ana Clara em prompt_versions (key pre_attendance_agent)                    | ✅ done      | critical   | —                                  |
| F16-S40 | Nó agent_turn (LLM tool-calling) + route_conversation + flag novo×funil                             | ✅ done      | critical   | F16-S39, F16-S42                   |
| F16-S41 | Saída estruturada {messages:[...]} (≤300) + envio multi-mensagem                                    | ✅ done      | critical   | F16-S40                            |
| F16-S42 | Estado leve do agente (campos coletados) + popular customer_name do lead                            | ✅ done      | high       | —                                  |
| F16-S43 | Aposentar o funil determinístico antigo atrás da flag agêntica                                      | 🟢 available | medium     | F16-S40, F16-S41                   |
| F16-S44 | Worker livechat-ai itera messages[] do agente (envio multi-mensagem ao WhatsApp)                    | ✅ done      | critical   | F16-S41                            |
| F16-S45 | Testes conversacionais do agent_turn por cenário (validação pré go-live)                            | ✅ done      | critical   | F16-S40                            |
| F16-S46 | Fix integração agêntica do pré-atendimento (bugs do smoke real)                                     | ✅ done      | critical   | —                                  |
| F16-S47 | Fix entrega do reply agêntico (reply channel + messages no response + persist/audit)                | ✅ done      | critical   | —                                  |
| F16-S48 | Fix correlationId não-UUID no nó log_decision (auditoria final 400)                                 | ✅ done      | high       | —                                  |
| F16-S49 | Timeout do worker→langgraph muito curto p/ o agente (fallback handoff indevido)                     | ✅ done      | critical   | —                                  |
| F16-S50 | Fix histórico conversacional do agente (mensagem nova descartada + assistant truncado)              | ✅ done      | critical   | —                                  |
| F16-S51 | sendMessage emite message:new (outbound) — mensagens do agente aparecem ao vivo no live chat        | ✅ done      | high       | —                                  |

## Fase 17 —

| ID      | Título                                                                        | Status  | Prioridade | Depende de                |
| ------- | ----------------------------------------------------------------------------- | ------- | ---------- | ------------------------- |
| F17-S01 | Schema — entidade `contracts` + migração `contract_reference` → `contract_id` | ✅ done | high       | —                         |
| F17-S02 | Contratos compartilhados — Zod de contrato + saúde de boletos                 | ✅ done | high       | F17-S01                   |
| F17-S03 | Backend — módulo de contratos (CRUD + "marcar como assinado")                 | ✅ done | high       | F17-S01, F17-S02          |
| F17-S04 | Backend — saúde de boletos do contrato (agregação)                            | ✅ done | medium     | F17-S01, F17-S02, F17-S03 |
| F17-S05 | Frontend — aba Contratos + ação "marcar como assinado"                        | ✅ done | high       | F17-S02, F17-S03          |
| F17-S06 | Frontend — ficha do contrato com gestão e saúde de boletos                    | ✅ done | medium     | F17-S04, F17-S05, F5-S16  |
| F17-S07 | Backend — visão cliente (dados + histórico + contratos + boletos)             | ✅ done | medium     | F17-S01, F17-S02, F17-S03 |
| F17-S08 | Frontend — CRM drill-down do cliente (ficha com contratos e boletos)          | ✅ done | medium     | F17-S02, F17-S07          |
| F17-S09 | Backend — win-back (detecta fim de contrato → tarefa + sugestão de simulação) | ✅ done | low        | F17-S01, F17-S03, F15-S05 |
| F17-S10 | Frontend — oportunidade de win-back (card/tarefa + simulação pré-preenchida)  | ✅ done | low        | F17-S09, F15-S10          |
| F17-S11 | Frontend — modal de criação de contrato                                       | ✅ done | high       | F17-S02, F17-S03, F17-S06 |
| F17-S12 | Schema — analysis_id em contracts (migration + Drizzle + shared)              | ✅ done | high       | F17-S01, F17-S02          |
| F17-S13 | Backend — handler auto-contrato por análise aprovada/recusada                 | ✅ done | high       | F17-S12, F17-S03          |
| F17-S14 | Frontend — badge "Contrato vinculado" na ficha da análise                     | ✅ done | medium     | F17-S12, F17-S13, F17-S06 |

## Fase 18 —

| ID      | Título                                                                                        | Status  | Prioridade | Depende de |
| ------- | --------------------------------------------------------------------------------------------- | ------- | ---------- | ---------- |
| F18-S01 | Backend — city_name em LeadResponse (Onda 1 item 1)                                           | ✅ done | high       | —          |
| F18-S02 | Frontend — cidade visível no CRM e no Kanban (Onda 1 item 1)                                  | ✅ done | high       | F18-S01    |
| F18-S03 | Frontend — CurrencyInput canônico + fix bug de moeda (Onda 1 item 3)                          | ✅ done | high       | —          |
| F18-S04 | Backend — endpoint activateRuleVersion (Onda 1 item 6)                                        | ✅ done | medium     | —          |
| F18-S05 | Frontend — "Usar esta versão" na RuleTimeline (Onda 1 item 6)                                 | ✅ done | medium     | F18-S04    |
| F18-S06 | Frontend — follow-up por estágio e outcome (Onda 1 item 8)                                    | ✅ done | medium     | —          |
| F18-S07 | Frontend — avgDaysInStage no dashboard + estágio Kanban no CRM (Onda 1 item 11)               | ✅ done | medium     | —          |
| F18-S08 | Schema — lead PJ + personal_email usuários (Onda 2 item 4)                                    | ✅ done | high       | —          |
| F18-S09 | Backend — lead PJ validações + email blocklist (Onda 2 item 4)                                | ✅ done | high       | F18-S08    |
| F18-S10 | Frontend — NewLeadModal campos PJ + email obrigatório + personal_email agente (Onda 2 item 4) | ✅ done | high       | F18-S09    |
| F18-S11 | Backend — endpoint "enviar simulação por WhatsApp" (Onda 2 item 2)                            | ✅ done | medium     | —          |
| F18-S12 | Frontend — botão "Enviar ao cliente" na simulação (Onda 2 item 2)                             | ✅ done | medium     | F18-S11    |

## Fase 19 —

| ID      | Título                                                                 | Status  | Prioridade | Depende de       |
| ------- | ---------------------------------------------------------------------- | ------- | ---------- | ---------------- |
| F19-S01 | Schema — law_firms + customer_law_firm_referrals (migration 0066)      | ✅ done | high       | —                |
| F19-S02 | Backend — CRUD law_firms + suggest por cidade                          | ✅ done | high       | F19-S01          |
| F19-S03 | Backend — ação "encaminhar para advocacia" + /internal/law-firm-status | ✅ done | high       | F19-S01, F19-S02 |
| F19-S04 | Frontend — admin cadastro de escritórios de advocacia                  | ✅ done | high       | F19-S02          |
| F19-S05 | Frontend — botão "Encaminhar para advocacia" na ficha do inadimplente  | ✅ done | high       | F19-S03, F19-S04 |
| F19-S06 | LangGraph — nó lawyer_handoff (envio autônomo do contato do advogado)  | ✅ done | medium     | F19-S03          |

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

## Fase 20 —

| ID      | Título                                                                                                                       | Status  | Prioridade | Depende de                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- | ---------------------------------- |
| F20-S01 | Schema — channel_id em followup_rules, followup_jobs, collection_rules, collection_jobs, credit_simulations (migration 0067) | ✅ done | high       | —                                  |
| F20-S02 | Backend — Channel Selection Service (resolução de canal para workers e módulos)                                              | ✅ done | high       | F20-S01                            |
| F20-S03 | Worker — followup-sender e followup-scheduler: multi-canal via tabela channels                                               | ✅ done | high       | F20-S01, F20-S02                   |
| F20-S04 | Worker — collection-sender e collection-scheduler: multi-canal via tabela channels                                           | ✅ done | high       | F20-S01, F20-S02                   |
| F20-S05 | Backend — simulations/service + billing/service: multi-canal via tabela channels                                             | ✅ done | high       | F20-S01, F20-S02                   |
| F20-S06 | Backend — templates/metaClient: gestão de templates HSM via canal do banco                                                   | ✅ done | medium     | F20-S02, F20-S05                   |
| F20-S07 | Frontend — canal padrão, seletor de canal em regras e simulações                                                             | ✅ done | high       | F20-S01, F20-S05                   |
| F20-S08 | Backend — deprecar env vars META*WHATSAPP*\* após migração completa para channels                                            | ✅ done | low        | F20-S03, F20-S04, F20-S05, F20-S06 |

## Fase 21 —

| ID      | Título                                                          | Status  | Prioridade | Depende de |
| ------- | --------------------------------------------------------------- | ------- | ---------- | ---------- |
| F21-S01 | Ajuda — revisar e enriquecer guias de Análise de crédito        | ✅ done | medium     | —          |
| F21-S02 | Ajuda — revisar e enriquecer guias de Live Chat e Agente de IA  | ✅ done | medium     | —          |
| F21-S03 | Ajuda — revisar e enriquecer guias de Contratos e Boletos       | ✅ done | low        | —          |
| F21-S04 | Ajuda — revisar e enriquecer guias de Cobrança, SPC e Advocacia | ✅ done | low        | —          |

## Fase 22 —

| ID      | Título                                                                            | Status  | Prioridade | Depende de |
| ------- | --------------------------------------------------------------------------------- | ------- | ---------- | ---------- |
| F22-S01 | Backend — hardening de isolamento e headers (auditoria de segurança 2026-06-22)   | ✅ done | high       | —          |
| F22-S02 | Backend — remediação de CVE em dependências runtime (drizzle-orm, xlsx)           | ✅ done | high       | —          |
| F22-S03 | Infra — ressuscita E2E Smoke (tsbuildinfo + rabbitmq CI + topologia socket-relay) | ✅ done | high       | —          |

## Fase 23 —

| ID      | Título                                                                       | Status    | Prioridade | Depende de                |
| ------- | ---------------------------------------------------------------------------- | --------- | ---------- | ------------------------- |
| F23-S01 | DB — views materializadas, índices e job de refresh para relatórios          | ✅ done   | high       | —                         |
| F23-S02 | RBAC — permissão reports:export e billing:read escopado para gestor_regional | ✅ done   | high       | —                         |
| F23-S03 | Backend — módulo reports (core): schemas Zod + overview/funil/atendimentos   | ✅ done   | high       | F23-S01, F23-S02          |
| F23-S04 | Backend — reports: crédito, cobrança e produtividade                         | ✅ done   | high       | F23-S03                   |
| F23-S05 | Backend — reports: saúde da IA/LLM e auditoria/operação                      | ✅ done   | medium     | F23-S03                   |
| F23-S06 | Frontend — shell de /relatorios, filtros adaptativos e Visão Geral           | ✅ done   | high       | F23-S03                   |
| F23-S07 | Frontend — seções Atendimentos, IA e Funil/CRM                               | ✅ done   | medium     | F23-S05, F23-S06          |
| F23-S08 | Frontend — seções Crédito, Cobrança, Produtividade e Auditoria               | ✅ done   | medium     | F23-S04, F23-S05, F23-S06 |
| F23-S09 | Backend — exportação de relatórios (CSV/XLSX/PDF) com RBAC e audit           | ✅ done   | medium     | F23-S04, F23-S05          |
| F23-S10 | Frontend — UI de exportação de relatórios                                    | ✅ done   | medium     | F23-S08, F23-S09          |
| F23-S11 | QA & Segurança — isolamento por papel, métricas×SQL e LGPD do export         | 🟣 review | high       | F23-S07, F23-S08, F23-S10 |

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

| ID     | Título                                                                                        | Status  | Prioridade | Depende de                                     |
| ------ | --------------------------------------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------- |
| F5-S01 | Schema followup_rules + followup_jobs + whatsapp_templates                                    | ✅ done | high       | F0-S04, F1-S09, F1-S15, F1-S23                 |
| F5-S02 | Worker followup-scheduler (gated)                                                             | ✅ done | high       | F5-S01, F1-S15, F1-S23                         |
| F5-S03 | Worker followup-sender + cliente Meta WhatsApp templates                                      | ✅ done | high       | F5-S01, F5-S02, F1-S15, F1-S20                 |
| F5-S04 | Cancelamento de followup por resposta do cliente                                              | ✅ done | high       | F5-S01, F5-S03, F1-S19, F1-S15                 |
| F5-S05 | Frontend — réguas de followup, jobs agendados e pausa manual                                  | ✅ done | medium     | F5-S01, F5-S02, F5-S03, F1-S08, F1-S23, F8-S08 |
| F5-S06 | Schema payment_dues + collection_rules + collection_jobs                                      | ✅ done | medium     | F5-S01, F1-S09, F1-S15, F1-S23, F1-S24         |
| F5-S07 | Workers collection-scheduler + collection-sender (gated)                                      | ✅ done | medium     | F5-S06, F5-S03, F1-S15                         |
| F5-S08 | Frontend cobrança + importação payment_dues + marcação manual                                 | ✅ done | medium     | F5-S06, F5-S07, F1-S08, F1-S17, F8-S08         |
| F5-S09 | Frontend templates WhatsApp + sync Meta Cloud + webhook de status                             | ✅ done | medium     | F5-S01, F5-S03, F1-S08, F1-S20, F8-S08         |
| F5-S10 | Schema — header de mídia em whatsapp_templates + campos de boleto em payment_dues + flags     | ✅ done | high       | F5-S01, F5-S06                                 |
| F5-S11 | Cliente Meta — parâmetro de mídia no envio + upload /media + header de mídia no catálogo      | ✅ done | high       | F5-S03, F5-S09, F5-S10                         |
| F5-S12 | Módulo templates — header_type (texto/documento/imagem) no CRUD + submit de header de mídia   | ✅ done | high       | F5-S10, F5-S11                                 |
| F5-S13 | Cobrança — anexar boleto à parcela (endpoint + import) com RBAC, auditoria e LGPD             | ✅ done | high       | F5-S10, F5-S11, F5-S08                         |
| F5-S14 | collection-sender — anexar header de boleto no envio de cobrança (re-upload + fallback)       | ✅ done | high       | F5-S11, F5-S13                                 |
| F5-S15 | Frontend templates — seletor de header (texto/documento/imagem) + upload de amostra + preview | ✅ done | medium     | F5-S12                                         |
| F5-S16 | Frontend cobrança — anexar/visualizar boleto na parcela (upload PDF + URL + linha/PIX)        | ✅ done | medium     | F5-S13                                         |

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
