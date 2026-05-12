# 12 — Tasks Técnicas

> Tasks granulares com Definition of Done. Ordem cronológica seguindo as fases de [11-roadmap-executavel.md](11-roadmap-executavel.md). Cada task tem: nome, objetivo, escopo, fora de escopo, arquivos prováveis, dependências, passos, critérios de aceite, testes, feature flag.

---

## Fase 0 — Preparação

### T0.1 — Criar monorepo com pnpm + Turborepo

**Objetivo:** estrutura base do projeto.
**Escopo:** `pnpm-workspace.yaml`, `turbo.json`, `package.json` raiz, `apps/*` placeholders, `packages/tsconfig`, `packages/eslint-config`.
**Fora:** código de domínio.
**Arquivos:** `pnpm-workspace.yaml`, `turbo.json`, `package.json`, `apps/web/package.json`, `apps/api/package.json`.
**Passos:** init pnpm; configurar workspaces; criar `tsconfig` base e estender em cada app; configurar Turbo pipelines (`build`, `lint`, `test`, `dev`).
**Aceite:** `pnpm install` funciona; `pnpm turbo run lint` passa; `pnpm turbo run dev` paraleliza.

### T0.2 — Configurar Postgres local via docker-compose

**Objetivo:** banco rodando localmente para dev.
**Arquivos:** `docker-compose.yml`, `.env.example`.
**Passos:** Postgres 16 com extensions `pgcrypto`, `pg_trgm`, `unaccent`, `citext` habilitadas no init script.
**Aceite:** `docker compose up postgres` funciona, conexão validada.

### T0.3 — Setup Drizzle ORM

**Arquivos:** `apps/api/drizzle.config.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/schema/index.ts`.
**Passos:** instalar `drizzle-orm`, `drizzle-kit`, `pg`. Criar client. Configurar migrations em `apps/api/src/db/migrations`.
**Aceite:** `pnpm db:generate` e `pnpm db:migrate` funcionam.

### T0.4 — Setup Fastify + Pino

**Arquivos:** `apps/api/src/server.ts`, `apps/api/src/config/env.ts`.
**Passos:** Fastify + plugin de logger, schema validation com Zod, error handler, request_id middleware, /health.
**Aceite:** `GET /health` retorna 200.

### T0.5 — Setup Vite + React + Tailwind + roteamento

**Arquivos:** `apps/web/*`.
**Passos:** Vite + React + TS estrito + Tailwind + React Router + TanStack Query + página de login placeholder.
**Aceite:** dev server roda, página de login renderiza.

### T0.6 — Setup FastAPI + LangGraph (skeleton)

**Arquivos:** `apps/langgraph-service/app/main.py`, `pyproject.toml`.
**Passos:** poetry/uv; FastAPI; endpoint `/health`; estrutura de pastas conforme [06-langgraph-agentes.md](06-langgraph-agentes.md).
**Aceite:** `uvicorn app.main:app` sobe, `/health` 200.

### T0.7 — GitHub Actions (lint/typecheck/test)

**Arquivos:** `.github/workflows/ci.yml`.
**Aceite:** PR roda pipeline, falha em erro de lint/typecheck.

### T0.8 — README de setup

**Arquivos:** `README.md`.
**Aceite:** dev novo consegue rodar tudo seguindo o README.

---

## Fase 1 — Base operacional

### T1.1 — Schema base (orgs, users, roles, permissions)

**Escopo:** migrations de `organizations`, `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_city_scopes`, `user_sessions`.
**Arquivos:** `apps/api/src/db/schema/identity.ts`, migration files, seed inicial.
**Aceite:** `pnpm db:migrate` aplica; seed cria org default + admin user.

### T1.2 — Auth: login, refresh, logout

**Arquivos:** `modules/auth/*`.
**Escopo:** rotas `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`. Bcrypt. JWT. Rate limit. CSRF.
**Aceite:** login retorna access+refresh; refresh rotaciona; logout revoga.
**Testes:** unit do service, integração das rotas, teste de rate limit.

### T1.3 — Middleware authenticate + authorize

**Arquivos:** `modules/auth/middlewares/*`.
**Escopo:** decoradores `authenticate()` e `authorize({ permissions, scope })`.
**Aceite:** rota sem auth → 401; sem permissão → 403; fora de escopo → 404 (não vaza existência).

### T1.4 — UI: login, layout autenticado, hook useAuth

**Arquivos:** `apps/web/src/features/auth/*`.
**Aceite:** login real funciona, refresh transparente, logout.

### T1.5 — Schema cities + agents

**Migrations** + seed das cidades de Rondônia (Porto Velho + outras atendidas).
**Aceite:** seed popula com aliases.

### T1.6 — CRUD cities (admin)

**Arquivos:** `modules/cities/*`. Tela `/admin/cities`.
**Aceite:** criar/editar cidade; aliases editáveis; usado em fuzzy match.

### T1.7 — CRUD agents + atribuições por cidade

**Arquivos:** `modules/agents/*`. Tela `/admin/agents`.
**Aceite:** atribuir agente a múltiplas cidades; primary city.

### T1.8 — CRUD users + roles + city scopes

**Arquivos:** `modules/users/*`. Tela `/admin/users`.
**Aceite:** admin cria usuário, atribui role e cidades; usuário criado consegue logar.

### T1.9 — Schema leads + customers + history + interactions

**Migrations** com índices ([03-modelo-dados.md](03-modelo-dados.md)).
**Aceite:** `pnpm db:migrate` ok.

### T1.10 — Service de normalização de telefone

**Arquivos:** `shared/phone.ts`. Lib: libphonenumber-js.
**Aceite:** unit tests cobrem formatos comuns BR.

### T1.11 — CRUD leads (manual)

**Arquivos:** `modules/leads/*`. Endpoints `/api/leads`.
**Escopo:** Zod schemas; service com dedupe; repository com filtro de cidade; eventos `leads.created`/`leads.updated`.
**Aceite:** criar/editar/listar/detalhar com escopo respeitado; tentar duplicar telefone → 409.

### T1.12 — Tela CRM (lista + detalhe + form)

**Arquivos:** `apps/web/src/features/crm/*`.
**Aceite:** listar com filtros (cidade, status, agente, busca), criar lead, ver timeline.

### T1.13 — Schema kanban + service de transições

**Arquivos:** `modules/kanban/*`.
**Escopo:** matriz de transições válidas; histórico append-only.
**Aceite:** mover entre stages com validação; revert exige permissão.

### T1.14 — Tela Kanban (board + detalhe modal)

**Aceite:** drag-and-drop; filtros; histórico.

### T1.15 — Outbox pattern

**Arquivos:** `events/outbox.ts`, `workers/outbox-publisher.ts`.
**Escopo:** helper `emit(event)` que grava na transação; worker que processa pendentes; `event_processing_logs` para idempotência.
**Aceite:** `leads.created` chega ao handler; falha de handler retentou e foi para DLQ após N tentativas.

### T1.16 — Audit logs

**Arquivos:** `modules/audit/*`. Helper `auditLog()` invocado em mutações sensíveis.
**Aceite:** audit registra before/after; tela `/admin/audit` com filtros.

### T1.17 — Pipeline de importação (genérico)

**Arquivos:** `modules/imports/*`, `workers/import-processor.ts`.
**Escopo:** upload, parse, mapping, validate, preview, confirm, process. Cobertura para `leads`.
**Aceite:** importar 100 leads CSV ponta a ponta com preview e relatório.
**Feature flag:** `crm.import.enabled`.

### T1.18 — Tela de importação (wizard 4 passos)

**Aceite:** UX descrita em [08-importacoes.md](08-importacoes.md).

### T1.19 — Webhook WhatsApp (entrada)

**Arquivos:** `modules/whatsapp/webhook.controller.ts`.
**Escopo:** validação HMAC, idempotência, persistência em `whatsapp_messages`, upsert `chatwoot_conversations`, evento `whatsapp.message_received`.
**Aceite:** webhook duplicado não cria duplicatas; assinatura inválida → 401.

### T1.20 — Cliente HTTP do Chatwoot

**Arquivos:** `integrations/chatwoot/client.ts`.
**Escopo:** atualizar attributes, criar mensagem, criar nota, atribuir agente.
**Aceite:** mocks + integração com instância de teste.

### T1.21 — Webhook Chatwoot (entrada)

**Arquivos:** `modules/chatwoot/webhook.controller.ts`.
**Aceite:** eventos `message_created`, `conversation_status_changed`, `conversation_assignee_changed` processados; idempotência por id+updated_at.

### T1.22 — Sync de atributos do Chatwoot (handler)

**Aceite:** após `leads.created`/`kanban.stage_updated`/`simulations.generated`, atributos da conversa são atualizados.

### T1.23 — Schema feature_flags + UI admin + cache

**Aceite:** toggle pela UI atualiza em ≤30s; audit registra.

### T1.24 — Middleware featureGate (backend)

**Aceite:** rota com flag `disabled` retorna 403 com payload claro.

### T1.25 — Hook useFeatureFlag (frontend)

**Aceite:** botões/menus respeitam flag; badges aparecem conforme `ui_label`.

### T1.26 — Tela /admin/integrations (status webhook + reprocessamento)

**Aceite:** lista DLQ; botão reprocessar funciona.

---

## Fase 2 — Crédito e simulação

### T2.1 — Schema credit_products + credit_product_rules + credit_simulations

**Aceite:** migrations + seed de 1 produto.

### T2.2 — Service de cálculo (Price + SAC)

**Arquivos:** `modules/simulations/calculator.ts`.
**Aceite:** unit tests com casos conhecidos; precisão decimal correta.

### T2.3 — CRUD produtos + publicação de regra

**Arquivos:** `modules/credit-products/*`. Tela `/products`.
**Escopo:** publicar regra cria nova versão e desativa anterior; nunca edita versão antiga.
**Aceite:** versões aparecem na timeline.

### T2.4 — Endpoint POST /api/simulations

**Aceite:** valida limites; persiste com `rule_version_id`; emite `simulations.generated`; retorna tabela amortização.

### T2.5 — Endpoint /internal/simulations (para IA)

**Aceite:** mesmo cálculo, mesmo evento; idempotência por chave.

### T2.6 — Tela simulador interno

**Aceite:** form valida; resultado clean; tabela amortização visível.

### T2.7 — Histórico de simulações na ficha do lead/customer

**Aceite:** lista com badge de versão; abrir detalhe mostra parcelas.

### T2.8 — Atualizar Kanban com last_simulation_id

**Aceite:** após `simulations.generated`, card reflete simulação.

---

## Fase 3 — LangGraph e agente externo

### T3.1 — Schema ai_conversation_states + ai_decision_logs + prompt_versions

**Aceite:** migrations.

### T3.2 — Endpoints /internal/conversations/:id/state (load/save)

**Aceite:** carrega estado por id; cria se não existir.

### T3.3 — Cliente HTTP base no LangGraph (com auth + retry + correlation)

**Arquivos:** `apps/langgraph-service/app/tools/_base.py`.
**Aceite:** mocks unit testados.

### T3.4 — Tool get_or_create_lead (Python) + endpoint /internal/leads/get-or-create (Node)

**Aceite:** dedupe por telefone normalizado; retorna `created` flag; emite `leads.created` quando aplicável; testado em par.

### T3.5 — Tool identify_city + endpoint

**Aceite:** fuzzy match (`pg_trgm` + `unaccent`); confidence retornado.

### T3.6 — Tool list_credit_products + endpoint

**Aceite:** retorna apenas produtos ativos.

### T3.7 — Tool generate_credit_simulation + endpoint /internal/simulations

**Aceite:** integra com Fase 2; idempotency.

### T3.8 — Tool request_handoff + endpoint /internal/handoffs

**Aceite:** cria handoff, atualiza Chatwoot (assignee + nota), emite eventos, move card se aplicável.

### T3.9 — Tool create_chatwoot_note + endpoint

**Aceite:** template renderizado; nota criada na conversa correta.

### T3.10 — Tool log_ai_decision + endpoint /internal/ai/decisions

**Aceite:** persistência em `ai_decision_logs`.

### T3.11 — Estado tipado ConversationState (Python)

**Aceite:** Pydantic + LangGraph TypedDict; serialização via persistência.

### T3.12 — Nó receive_message + load_state

**Aceite:** carrega estado, append em messages.

### T3.13 — Nó classify_intent

**Aceite:** prompt versionado; retorna intent dentro do enum; teste com fixtures.

### T3.14 — Nós identify_or_create_lead, identify_city com confirmação

**Aceite:** confidence baixo dispara pergunta; após resposta, atualiza.

### T3.15 — Nós qualify_credit_interest, generate_simulation, save_simulation

**Aceite:** valor, prazo, produto coletados; simulação criada via tool.

### T3.16 — Nós decide_next_step + request_handoff + send_response + persist_state + log_decision

**Aceite:** roteamento conforme intenção.

### T3.17 — Endpoint POST /process/whatsapp/message no LangGraph

**Aceite:** orquestra grafo; retorna payload conforme contrato.

### T3.18 — Backend chama LangGraph após webhook WhatsApp

**Aceite:** mensagem entrante → IA responde → resposta enviada via WhatsApp; logs salvos.

### T3.19 — Fallback de handoff em falha do LangGraph

**Aceite:** timeout/erro → mensagem padrão + handoff criado; testado.

### T3.20 — Testes conversacionais (5 fixtures)

**Aceite:** rodam em CI; cobrem fluxos felizes e divergentes.

### T3.21 — Testes de prompt injection

**Aceite:** mensagens hostis não burlam restrições; logs marcam suspicious.

---

## Fase 4 — Análise de crédito

### T4.1 — Schema credit_analyses + credit_analysis_versions

**Aceite:** migrations + constraint de imutabilidade de versão (via service, sem trigger no MVP).

### T4.2 — Service de análise (criação + nova versão)

**Aceite:** PATCH cria nova versão; antiga preservada.

### T4.3 — Endpoints /api/credit-analyses + /api/customers/:id/analyses

**Aceite:** RBAC + escopo + audit.

### T4.4 — Tela lista + detalhe + form de nova versão

**Aceite:** timeline de versões; diff visível.

### T4.5 — Importação de análises (extends pipeline)

**Aceite:** preview; vínculos com lead/customer/simulação; eventos.

### T4.6 — Tool get_credit_analysis_history (apenas leitura, mascarada para grafo externo)

**Aceite:** grafo externo recebe versão sanitizada; assistente interno recebe completo conforme permissão.

### T4.7 — Promoção a aprovado/recusado dispara mudança no Kanban

**Aceite:** evento + handler.

---

## Fase 5 — Automações (gated)

### T5.1 — Schema followup_rules + followup_jobs + whatsapp_templates

**Aceite:** migrations + seed de 4 regras (D+1, D+3, D+7, D+15).

### T5.2 — Worker followup-scheduler

**Aceite:** consome eventos `kanban.stage_updated`/`leads.created` e cria jobs com idempotency.

### T5.3 — Worker followup-sender

**Aceite:** lê jobs vencidos, envia template via WhatsApp, registra status.

### T5.4 — Cancelamento por resposta do cliente

**Aceite:** evento de mensagem entrante cancela jobs futuros da régua.

### T5.5 — UI de réguas + jobs + pausa manual

**Aceite:** com flag desligada, UI mostra "Em desenvolvimento" e nada é enviado.

### T5.6 — Schema payment_dues + collection_rules + collection_jobs

**Aceite:** migrations.

### T5.7 — Importação de payment_dues

**Aceite:** preview + dedupe.

### T5.8 — Workers collection-scheduler/sender

**Aceite:** mesma estrutura do followup.

### T5.9 — Marcação manual: pago, renegociado, inadimplente

**Aceite:** UI + eventos.

---

## Fase 6 — Assistente interno e dashboards

### T6.1 — Views materializadas (overview, funil, dwell time)

**Aceite:** `pnpm db:refresh-views` funciona; dados batem com SQL.

### T6.2 — Job de refresh periódico (5 min)

**Aceite:** worker dedicado.

### T6.3 — APIs de dashboard

**Aceite:** filtros respeitam escopo.

### T6.4 — Tela de dashboards

**Aceite:** cards habilitados conforme flags; gated mostra "Em desenvolvimento".

### T6.5 — Grafo internal_assistant

**Aceite:** nós conforme [06-langgraph-agentes.md](06-langgraph-agentes.md).

### T6.6 — Tools do assistente (somente leitura)

**Aceite:** todas com escopo aplicado; testes de cross-cidade.

### T6.7 — Endpoint POST /api/internal-assistant/query + tela de chat

**Aceite:** experiência fluida; histórico salvo.

### T6.8 — Logs assistant_queries + tela admin

**Aceite:** auditoria visível para `audit:read`.

---

## Fase 7 — Migração e go-live

### T7.1 — Script export Notion → CSV normalizado

**Aceite:** roda contra API Notion com rate limit; gera arquivo padrão.

### T7.2 — Script export Trello → JSON

**Aceite:** export completo.

### T7.3 — Importação em staging com conferência

**Aceite:** gestor valida amostragem.

### T7.4 — Documento de cutover

**Aceite:** passos detalhados, rollback definido, comunicações pré-escritas.

### T7.5 — Treinamento (sessões + material)

**Aceite:** todos agentes treinados; checklist de prontidão.

### T7.6 — Go-live + monitoramento 7 dias

**Aceite:** sem incidente bloqueante; métricas estáveis.

### T7.7 — Decommissioning Notion/Trello

**Aceite:** integrações removidas; logs arquivados.

---

## Convenções aplicadas a TODAS as tasks

- Branch: `feat/<fase>-<numero>-<slug>` (ex: `feat/3-08-tool-request-handoff`).
- Commits semânticos.
- PR exige: descrição, checklist de aceite, screenshot/recording quando UI, link para task, revisão obrigatória.
- Migrations sempre revisadas manualmente. Migration de drop só com aprovação dupla.
- Tests obrigatórios:
  - Unit em service.
  - Integração em rota crítica.
  - Permissão (positivo + negativo).
  - Idempotência onde aplicável.
- Audit log obrigatório em mutações sensíveis listadas em [10-seguranca-permissoes.md](10-seguranca-permissoes.md).

## Definition of Done padrão

```md
- [ ] Código implementado conforme escopo
- [ ] Testes unitários e de integração passando
- [ ] Permissões e escopo validados (testes positivos e negativos)
- [ ] Eventos emitidos quando aplicável e idempotência testada
- [ ] Audit log aplicado quando aplicável
- [ ] Feature flag respeitada nas 4 camadas (UI, API, worker, tool) quando aplicável
- [ ] Logs estruturados com correlation_id
- [ ] Documentação atualizada (README do módulo + docs/\* se mudou contrato)
- [ ] Revisão de código aprovada
- [ ] CI verde
- [ ] Manualmente testado em ambiente de dev
```
