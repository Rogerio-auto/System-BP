# ARCHITECTURE.md

Decisões arquiteturais do Manager Banco do Povo. Para a visão de alto nível ver [docs/02-arquitetura-sistema.md](docs/02-arquitetura-sistema.md). Este documento foca em **decisões técnicas** com justificativa.

## Stack escolhida

| Camada          | Escolha                                                           | Por que                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo        | **pnpm workspaces + Turborepo**                                   | Três apps com contratos compartilhados (Zod, tipos), CI unificado, refactor cross-app sem fricção. Turbo dá cache inteligente em build/lint/test. Lerna é legacy; Nx é overkill. |
| Frontend        | **React 18 + Vite + TypeScript estrito + Tailwind 3**             | Vite > webpack/CRA por velocidade. TS estrito (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Tailwind 3 dark-first é a base da identidade visual world-class.       |
| Estado servidor | **TanStack Query**                                                | Padrão de mercado, cache + invalidação corretos, devtools maduros. tRPC foi descartado por adicionar acoplamento que prejudica os agentes IA gerando código.                     |
| Estado cliente  | **Zustand** (mínimo)                                              | Redux é overkill. Context puro é frágil em escala. Zustand é a opção certa para estado UI local.                                                                                 |
| Forms           | **React Hook Form + Zod**                                         | Performance + revalidação parcial + mesmos schemas do backend.                                                                                                                   |
| Backend         | **Fastify 5 + TypeScript estrito**                                | 2-3x mais performante que Express, schema-driven, plugin system limpo. NestJS adiciona DI/decorators sem ganho proporcional para esse tamanho de projeto.                        |
| ORM             | **Drizzle 0.34**                                                  | SQL-first, sem mágica de runtime, migrations versionadas, tipos derivados do schema. Prisma tem overhead de engine binário e queries opacas.                                     |
| Validação       | **Zod 3** em todas as bordas                                      | Single source of truth: schema gera tipo TS + valida request/response + valida eventos + valida contratos com tools de IA.                                                       |
| Banco           | **PostgreSQL 16**                                                 | Transações fortes, JSONB, índices parciais, `pg_trgm` para fuzzy match de cidades, outbox pattern em SQL puro.                                                                   |
| Filas (MVP)     | **Outbox em Postgres + worker Node**                              | Sem dependência extra. `LISTEN/NOTIFY` reduz latência de polling. Migra para BullMQ/Redis quando volume justificar.                                                              |
| Auth            | **JWT curto (15min) + refresh rotativo (cookie httpOnly) + CSRF** | Sem vendor lock. Lucia/Better-Auth como base se precisar de mais. Auth0/Clerk descartados por custo recorrente e perda de controle.                                              |
| Logs            | **Pino + correlation_id**                                         | Estruturado, JSON em prod, pino-pretty em dev. OpenTelemetry exporter quando produção exigir tracing.                                                                            |
| AI              | **Python 3.12 + LangGraph + LangChain**                           | LangGraph dá grafos tipados auditáveis. Python é a ferramenta certa para o ecossistema LLM hoje. **Serviço isolado** — nunca toca no banco.                                      |
| Deploy local    | **Docker Compose**                                                | Padrão. Postgres + API + Web + LangGraph com health checks e volumes nomeados.                                                                                                   |

## Decisões críticas

### LangGraph não acessa o banco

Toda leitura/escrita do agente passa por endpoints `/internal/*` do backend, autenticados com `X-Internal-Token`. Isso garante:

- regra de negócio centralizada e auditada,
- impossível IA escrever errado direto no banco,
- todas as mutações da IA passam por validação Zod + RBAC + audit.

### Outbox antes de fila externa

Volume MVP não justifica Redis. Outbox com `SELECT ... FOR UPDATE SKIP LOCKED` resolve com idempotência por `(event_id, handler_name)`. Quando volume crescer, migrar para BullMQ + Redis sem mudar contratos.

### Versionamento de regras de crédito

`credit_product_rules.version` é imutável. Toda simulação grava `rule_version_id` (FK). Atualização cria nova versão; nunca edita a anterior. Garante que simulação antiga continua válida e auditável.

### Multi-tenant futuro sem refactor

`organization_id` adicionado em todas as tabelas desde já, com valor default. Quando virar multi-tenant real, basta ligar a coluna em filtros — sem migration de schema pesada.

### Permissão por cidade no repository

Não confiamos em filtros aplicados em `service`. O repository injeta o filtro de cidade automaticamente para roles com `scope=city`. Bypass exige uma flag explícita testada.

## Segurança (fundação, não fase)

- **Dockerfiles multi-stage**, non-root user em todos os serviços, sem dev tools no stage final.
- **`.dockerignore` em cada serviço** — nada vaza pra imagem.
- **Secrets só via env**, nunca no compose, nunca em build args.
- **Helmet + CORS allowlist + Rate limit** desde o init.
- **HMAC validado** em todo webhook entrante (WhatsApp, Chatwoot).
- **Idempotency keys** em rotas POST sensíveis.
- **Audit logs** para mutações sensíveis a partir da Fase 1 (T1.16).
- **Testes de RBAC e cross-cidade** obrigatórios em cada módulo.

## Estrutura de pastas

```
Elemento/
├── apps/
│   ├── api/                    Backend Fastify
│   │   ├── src/
│   │   │   ├── config/         env validado por Zod
│   │   │   ├── db/             Drizzle client + schemas + migrations
│   │   │   ├── modules/        Domínio (auth, leads, kanban, ...)
│   │   │   ├── events/         Outbox + tipos de eventos
│   │   │   ├── workers/        Processos separados (outbox, imports, ...)
│   │   │   ├── integrations/   Clientes HTTP (chatwoot, whatsapp)
│   │   │   ├── shared/         Helpers transversais
│   │   │   ├── app.ts          Fábrica do Fastify
│   │   │   └── server.ts       Bootstrap
│   │   ├── Dockerfile          Produção (multi-stage, non-root)
│   │   └── Dockerfile.dev      Dev (hot reload)
│   ├── web/                    Frontend React+Vite
│   │   ├── src/
│   │   │   ├── features/       Por domínio (auth, crm, kanban, ...)
│   │   │   ├── components/     Primitivos UI
│   │   │   ├── lib/            api client, helpers
│   │   │   └── styles/
│   │   └── Dockerfile          Build estático servido por nginx-unprivileged
│   └── langgraph-service/      Python FastAPI + LangGraph
│       ├── app/
│       │   ├── main.py
│       │   ├── config.py
│       │   ├── api/            HTTP endpoints
│       │   ├── graphs/         Grafos (whatsapp_pre_attendance, internal_assistant)
│       │   ├── tools/          Tools que falam com /internal/* do backend
│       │   └── prompts/        Versionados por arquivo
│       └── Dockerfile          Produção (multi-stage, non-root)
├── packages/
│   ├── shared-types/           Tipos TS puros
│   ├── shared-schemas/         Zod schemas compartilhados
│   ├── tsconfig/               Configs base
│   └── eslint-config/
├── infra/
│   └── postgres/init/          SQL de inicialização (extensions)
├── docs/                       Documentação técnica do produto
├── tasks/                      Sistema de slots para agentes IA
│   ├── PROTOCOL.md
│   ├── README.md
│   └── slots/F0..F7/           Slots por fase
├── docker-compose.yml          Produção-like
├── docker-compose.override.yml.example   Dev (hot reload)
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

## Ports (dev local)

| Serviço             | Porta |
| ------------------- | ----- |
| Postgres            | 5432  |
| API (Fastify)       | 3333  |
| Web (Vite)          | 5173  |
| LangGraph (FastAPI) | 8000  |

## Custos esperados (alvo)

- LLM por conversa: alvo < US$ 0.05 com cache de prompt + Sonnet/Haiku.
- Budget diário: `LLM_DAILY_BUDGET_USD` com alerta + soft block.
- Postgres: 1 instância pequena (2vCPU/4GB) cobre MVP confortavelmente.
- Workers: mesmo runtime da API, processos separados.
