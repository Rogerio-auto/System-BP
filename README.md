# Manager Banco do Povo — Elemento

Plataforma multiagente, multi-cidade, event-driven, para gestão de crédito do Banco do Povo de Rondônia. Substitui o MVP atual (Notion + Trello + IA com dados fixos) por uma plataforma de produção com PostgreSQL como fonte central da verdade.

> Documentação técnica completa: [docs/](docs/00-visao-geral.md). Sempre comece pela visão geral.

## Arquitetura

```
apps/
├── web/                    React + Vite + Tailwind (Manager interno)
├── api/                    Fastify + Drizzle (regras + persistência + outbox)
└── langgraph-service/      FastAPI + LangGraph (agentes — nunca acessa banco direto)
packages/
├── shared-types/           DTOs/enums TS compartilhados
├── shared-schemas/         Zod schemas compartilhados
├── tsconfig/               Configs TS base
└── eslint-config/          Config ESLint base
infra/
└── postgres/init/          Extensions e seeds iniciais
docs/                       Documentação técnica
```

Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md) e [docs/02-arquitetura-sistema.md](docs/02-arquitetura-sistema.md).

## Setup local

**Pré-requisitos:** Node 20.11+, pnpm 9.12+, Python 3.12+, Docker + Docker Compose.

```powershell
# 1. Variáveis de ambiente
copy .env.example .env
# (preencha os valores em .env)

# 2. Subir banco (Docker)
docker compose up -d postgres

# 3. Instalar dependências
pnpm install

# 4. Aplicar migrations
pnpm db:migrate

# 5. Setup do serviço Python
cd apps/langgraph-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
cd ..\..

# 6. Subir tudo em dev (api + web + langgraph + postgres)
pnpm dev
```

Para subir tudo via Docker (modo dev com hot reload):

```powershell
copy docker-compose.override.yml.example docker-compose.override.yml
docker compose up
```

## Comandos principais

| Comando             | O que faz                                 |
| ------------------- | ----------------------------------------- |
| `pnpm dev`          | Sobe `api` + `web` em paralelo (turbo)    |
| `pnpm build`        | Build de todos os apps                    |
| `pnpm lint`         | ESLint em todo o monorepo                 |
| `pnpm typecheck`    | TS check em todo o monorepo               |
| `pnpm test`         | Testes em todo o monorepo                 |
| `pnpm db:generate`  | Gera migration Drizzle a partir do schema |
| `pnpm db:migrate`   | Aplica migrations no banco                |
| `pnpm compose:up`   | `docker compose up -d`                    |
| `pnpm compose:down` | `docker compose down`                     |

## Desenvolvimento por agentes IA

Este projeto é construído por agentes IA trabalhando em **slots** independentes.

- Sistema de slots: [tasks/README.md](tasks/README.md)
- Protocolo: [tasks/PROTOCOL.md](tasks/PROTOCOL.md)
- Slots prontos para execução: [tasks/slots/](tasks/slots/)

Cada slot é uma unidade fechada de trabalho com escopo, dependências, contratos e Definition of Done explícitos. Agentes pegam slots em estado `available`, executam, abrem PR, e o slot vai para `done`.

## Padrões inegociáveis

1. **Postgres é a fonte da verdade.** LangGraph nunca escreve direto no banco.
2. **TypeScript estrito.** `strict: true`, `noUncheckedIndexedAccess: true`, sem `any`.
3. **Validação nas bordas.** Zod em todo input/output HTTP.
4. **Outbox pattern** em mutações que emitem eventos.
5. **Permissão por cidade é first-class.** Repository injeta filtro automaticamente.
6. **Versionamento de regras de simulação.** Simulação antiga preserva regra da época.
7. **Auditoria desde o primeiro commit.** Não é fase posterior.
8. **Feature flags reais.** Bloqueiam UI + API + worker + tool.
9. **Segurança como fundação.** Multi-stage Docker, non-root, `.dockerignore` em todo serviço, secrets nunca hardcoded.
10. **Sem código placeholder.** Tudo que existe funciona.
