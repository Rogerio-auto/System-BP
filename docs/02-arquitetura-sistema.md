# 02 — Arquitetura do Sistema

## 1. Visão de alto nível

```
                     ┌────────────────────────────────────────────┐
                     │                   USUÁRIOS                  │
                     │  Cliente final (WhatsApp)  ·  Operadores    │
                     └────────────────────────────────────────────┘
                                  │                       │
                          ┌───────┘                       └────────┐
                          ▼                                        ▼
                 ┌─────────────────┐                      ┌──────────────────┐
                 │ WhatsApp API    │                      │  Manager Web     │
                 │ Oficial (Meta)  │                      │  React/Tailwind  │
                 └────────┬────────┘                      └────────┬─────────┘
                          │ webhook                                │ HTTPS
                          ▼                                        ▼
                  ┌──────────────────────────────────────────────────────┐
                  │            BACKEND API · Node.js + TypeScript        │
                  │  Auth · RBAC · Domínio · Drizzle · Outbox · Workers  │
                  └──┬───────────────┬───────────────┬─────────────────┬─┘
                     │               │               │                 │
              HTTP   │  HTTP         │  SQL          │  HTTP           │ HTTP
                     ▼               ▼               ▼                 ▼
            ┌───────────────┐ ┌─────────────┐ ┌───────────────┐ ┌──────────────┐
            │  LangGraph    │ │ PostgreSQL  │ │   Chatwoot    │ │   Workers    │
            │  Service Py   │ │  16 (única  │ │  (atendimento │ │  Node (jobs, │
            │  (FastAPI)    │ │  fonte da   │ │   humano)     │ │   outbox,    │
            │               │ │  verdade)   │ │               │ │   import)    │
            └───────────────┘ └─────────────┘ └───────────────┘ └──────────────┘
```

## 2. Componentes

### 2.1 Manager Web (`apps/web`)
- React 18 + TypeScript + Vite + Tailwind 3.
- Roteamento: React Router.
- Estado servidor: TanStack Query.
- Estado cliente: Zustand (mínimo).
- Forms: React Hook Form + Zod (mesmos schemas do backend via `packages/shared-types`).
- Auth: tokens JWT curtos (access ~15min) + refresh em cookie httpOnly.
- Feature flags carregadas no bootstrap (`/api/feature-flags/me`) e revalidadas a cada navegação importante.
- Acesso baseado em escopo do usuário: cidades permitidas vêm no JWT e são usadas para gating de UI (mas a fonte de verdade é o backend).

### 2.2 Backend API (`apps/api`)
- Fastify (não Express): performance, schema-driven, plugin system limpo.
- TypeScript estrito (`strict: true`, `noUncheckedIndexedAccess: true`).
- Drizzle ORM + drizzle-kit para migrations.
- Validação: Zod em todas as bordas (request, response, eventos, tools).
- Camadas: `route → controller → service → repository → schema`. Regra de negócio só em `service`.
- Logs: Pino com `request_id` e `correlation_id`.
- OpenTelemetry opcional para tracing.
- Background jobs: tabela `jobs` no Postgres + worker Node usando `pg-boss` ou implementação simples. Migração futura para BullMQ se justificado.
- Outbox pattern: toda mutação que emite evento grava `event_outbox` na mesma transação. Worker dedicado publica para consumidores.

### 2.3 LangGraph Service (`apps/langgraph-service`)
- Python 3.12 + FastAPI + LangGraph + LangChain.
- Stateless do ponto de vista de processo. Estado conversacional em PostgreSQL via API do backend (tool `get_conversation_state` / `save_conversation_state`).
- **Não tem acesso direto ao banco.** Todas as operações de leitura/escrita passam por endpoints internos do backend (`/internal/...`) autenticados com chave compartilhada (`LANGGRAPH_INTERNAL_TOKEN`).
- Dois grafos principais: `whatsapp_pre_attendance` e `internal_assistant`.
- Prompts versionados em arquivos com hash + número de versão registrado nos logs.
- Testes de fluxo conversacional com fixtures.

### 2.4 PostgreSQL
- Versão 16+.
- Extensions: `pgcrypto` (hashes/UUIDs), `pg_trgm` (busca textual), `unaccent` (matching de cidade), `citext` (emails).
- Schema único `public` no MVP. Convenção `snake_case`.
- Migrations versionadas em `apps/api/src/db/migrations`.
- Backup diário + WAL archiving em produção.

### 2.5 Workers
- Mesmo runtime do backend, processo separado.
- Tipos de worker:
  - `outbox-publisher`: lê `event_outbox`, processa eventos.
  - `import-processor`: processa lotes de importação.
  - `chatwoot-sync`: reprocessa webhooks falhos.
  - `followup-scheduler` (gated por flag).
  - `collection-scheduler` (gated por flag).
- Locking via `SELECT ... FOR UPDATE SKIP LOCKED` ou advisory locks.

### 2.6 Chatwoot
- Instância existente do cliente.
- Backend consome API do Chatwoot e recebe webhooks.
- Custom attributes da conversa armazenam `lead_id`, `cidade`, `produto`, `simulacao_id`.
- Notas internas geradas pelo backend trazem resumo da IA.

### 2.7 WhatsApp API Oficial
- Integração via Cloud API da Meta (ou via provedor BSP existente).
- Webhook de mensagens entrantes → backend.
- Envio de mensagens via API HTTP, com idempotency key.
- Templates aprovados gerenciados em tabela `whatsapp_templates`.

## 3. Estrutura de repositório (monorepo)

**Decisão:** monorepo com pnpm workspaces + Turborepo. Justificativa: três apps com contratos compartilhados (tipos, schemas Zod), CI unificado, refactor cross-app sem fricção.

```
Elemento/
├── apps/
│   ├── web/                    # React + Tailwind
│   ├── api/                    # Backend Node.js
│   └── langgraph-service/      # Serviço Python LangGraph
├── packages/
│   ├── shared-types/           # Tipos TS compartilhados (DTOs, enums)
│   ├── shared-schemas/         # Zod schemas compartilhados web↔api
│   ├── eslint-config/
│   └── tsconfig/
├── docs/                       # Esta documentação
├── infra/
│   ├── docker/
│   └── compose/
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

Detalhamento das pastas internas em [11-roadmap-executavel.md](11-roadmap-executavel.md) (Fase 0).

## 4. Comunicação entre serviços

### 4.1 Frontend ↔ Backend
- HTTPS, JSON, REST com convenção REST/RPC pragmática (`POST /api/leads`, `POST /api/imports/leads/preview`, etc.).
- Auth: Bearer JWT no header. Refresh em cookie httpOnly + CSRF token.
- Versionamento: prefixo `/api/v1/...`.

### 4.2 Backend ↔ LangGraph
- HTTPS, JSON, REST.
- **Direção Backend → LangGraph:** o backend chama o serviço para processar mensagens.
- **Direção LangGraph → Backend (tools):** LangGraph chama endpoints internos `/internal/...` para executar tools.
- Auth: header `X-Internal-Token: <segredo>` rotacionável.
- Timeout: 8s para chamada de processamento síncrono. Acima disso, fallback para handoff.
- Retry: 1 retry com backoff exponencial em erro 5xx. Idempotency key obrigatória.

### 4.3 Backend ↔ Chatwoot
- API HTTP do Chatwoot com `api_access_token`.
- Webhook do Chatwoot → backend valida assinatura HMAC.

### 4.4 Backend ↔ WhatsApp
- Cloud API Meta com token de acesso.
- Webhook valida `hub.verify_token` + assinatura HMAC X-Hub-Signature.

### 4.5 Backend ↔ Worker
- Via tabela `jobs` no Postgres (não há fila externa no MVP).
- Worker faz polling com `LISTEN/NOTIFY` para reduzir latência.

## 5. Padrão de design

### 5.1 Arquitetura modular no backend
Cada módulo em `apps/api/src/modules/<modulo>` contém:
```
modules/leads/
├── leads.routes.ts          # binding HTTP
├── leads.controller.ts      # parsing + delegação
├── leads.service.ts         # regra de negócio
├── leads.repository.ts      # acesso a dados via Drizzle
├── leads.schemas.ts         # Zod
├── leads.events.ts          # contratos de eventos emitidos
└── leads.test.ts
```

### 5.2 Outbox pattern
- Toda mutação que emite evento faz duas escritas na mesma transação:
  1. Mutação do agregado.
  2. Insert em `event_outbox` com payload, tipo, status `pending`.
- Worker `outbox-publisher` lê pendentes em ordem, processa handlers, marca `processed` ou `failed`.
- Idempotência por `(event_id, handler_name)`.

### 5.3 Idempotência
- Toda rota POST que pode ser repetida (webhooks, criação de mensagem, follow-up, simulação) aceita header `Idempotency-Key`.
- Tabela `idempotency_keys` com `key`, `endpoint`, `request_hash`, `response_body`, `created_at`.

### 5.4 Versionamento de regras de negócio
- `credit_products` e `credit_product_rules` têm `version` e `is_active`.
- Toda simulação grava `rule_version_id` (FK imutável).
- Atualização de regra cria nova `version`, nunca edita a anterior.

## 6. Estratégia de autenticação e autorização

### 6.1 Autenticação
- Login com email + senha (bcrypt cost 12).
- 2FA TOTP opcional (recomendado para admin/gestor geral) — visível-mas-desabilitado no MVP.
- JWT access ~15min + refresh token rotativo em cookie httpOnly + CSRF.
- Sessões ativas listadas em `user_sessions` com `revoked_at`.

### 6.2 Autorização
- RBAC com escopo:
  - `role` (admin, gestor_geral, gestor_regional, agente, operador, leitura).
  - `city_scopes` (lista de `city_id` que o usuário acessa).
- Guard middleware: toda rota declara `permissions: ['leads:read']` e opcionalmente `scope: 'city'`.
- Repository camada injeta filtro de cidade automaticamente para roles com `scope=city`.

Detalhe completo em [10-seguranca-permissoes.md](10-seguranca-permissoes.md).

## 7. Estratégia de deploy

### 7.1 Ambientes
- **dev**: docker-compose local (Postgres, API, web, langgraph, redis-stub).
- **staging**: ambiente espelho da produção. Dados de teste anonimizados.
- **prod**: ambiente do cliente. A definir entre Fly.io / Railway / VPS com Coolify.

### 7.2 CI/CD
- GitHub Actions:
  - lint + typecheck + test em PR.
  - build em merge para `main`.
  - deploy automático para staging.
  - deploy para prod com aprovação manual.
- Migrations rodam em job separado, antes do deploy de aplicação.
- Rollback: tag de release imutável + estratégia de reversão de migration documentada por migration.

### 7.3 Configuração
- Tudo via variáveis de ambiente.
- `.env.example` com todas as chaves.
- Secrets em provedor (1Password Secrets, Doppler, ou variáveis nativas da plataforma).

## 8. Observabilidade

| Sinal | Ferramenta sugerida | Mínimo MVP |
|-------|---------------------|------------|
| Logs estruturados | Pino + agregador (Better Stack / Axiom / Loki) | sim |
| Métricas | Prometheus / OpenTelemetry exporter | parcial |
| Tracing | OpenTelemetry → Tempo / Jaeger | opcional |
| Erros | Sentry | sim |
| Uptime | UptimeRobot ou equivalente | sim |
| AI decisions | Tabela `ai_decision_logs` + dashboard interno | sim |

## 9. Estratégia de migração do MVP atual

Detalhada em [11-roadmap-executavel.md](11-roadmap-executavel.md) Fase 7. Resumo:

1. Exportação dos dados de Notion (CSV/CSV via API).
2. Exportação de Trello (JSON via API).
3. Normalização local (script Node em `apps/api/scripts/migrations/notion`).
4. Importação via módulo `imports` em homologação.
5. Conferência com usuários em staging.
6. Operação paralela: durante transição, agente IA roda contra o novo Postgres, Notion/Trello viram somente leitura.
7. Cutover: desligamento das integrações Notion/Trello.
8. Pós-cutover: monitorar 7 dias, manter rollback possível.

## 10. Trade-offs e decisões registradas

| Decisão | Opção escolhida | Alternativa | Razão |
|---------|-----------------|-------------|-------|
| Repositório | Monorepo (pnpm + Turbo) | Polirrepo | Contratos compartilhados, refactor cross-app, CI unificado |
| Estilo de API | REST com pragmatismo RPC | GraphQL / tRPC | Simplicidade, ecossistema, tooling para agentes IA |
| Filas | Postgres outbox + worker | Redis/BullMQ | Menos infra no MVP. Migrar quando volume justificar |
| ORM | Drizzle | Prisma | SQL-first, sem mágica, melhor para queries complexas |
| Web framework backend | Fastify | Express / NestJS | Performance + plugin system limpo. NestJS adicionaria overhead sem ganho proporcional |
| LangGraph acessa o banco? | Não, via API interna | Sim, direto | Centraliza regra de negócio, audita, evita IA escrever errado |
| Estado conversacional | Postgres via API | Redis / em memória | Postgres já é fonte da verdade, sem nova dep |
| Auth | Lucia/Better-Auth + JWT | Auth0 / Clerk | Sem vendor lock, controle total, custo zero |
| i18n | pt-BR hard | i18next | Cliente é regional, prazo curto |
| Multi-tenant | Coluna `organization_id` desde já, ativada depois | Schema-per-tenant | Migração futura sem refactor pesado |

## 11. Diagrama textual de fluxos

### Mensagem entrante WhatsApp
```
WhatsApp → Webhook /api/whatsapp/webhook (verifica HMAC, idempotency)
        → grava whatsapp_messages
        → grava chatwoot_conversations (upsert)
        → POST /internal/ai/conversations/process-message para LangGraph
        → LangGraph processa (tools chamam /internal/...)
        → Resposta volta com reply + actions + handoff
        → Backend envia reply via WhatsApp ou cria handoff Chatwoot
        → event_outbox: ai_decision_logged, message_sent
        → Worker outbox publica eventos
```

### Importação de leads
```
UI → POST /api/imports/leads (upload)
   → cria import_batches (status: parsing)
   → worker import-processor parseia, valida, popula import_rows
   → status: ready_for_review
UI → GET /api/imports/:id/preview (mostra válidas/inválidas)
UI → POST /api/imports/:id/confirm
   → worker processa linhas válidas
   → cria leads + customers + kanban_cards
   → emite lead_imported por linha
   → status: completed
```
