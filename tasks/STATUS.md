# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 14    | 0   | 0   | 0   | 0   | 0   | 14  |
| F1   | 28    | 0   | 0   | 0   | 0   | 0   | 28  |
| F2   | 11    | 0   | 0   | 0   | 0   | 0   | 11  |
| F3   | 1     | 0   | 0   | 0   | 0   | 0   | 1   |
| F8   | 7     | 0   | 0   | 0   | 0   | 1   | 6   |

## Fase 0 — Preparação

| ID      | Título                                                                        | Status  | Prioridade | Depende de                     |
| ------- | ----------------------------------------------------------------------------- | ------- | ---------- | ------------------------------ |
| F0-S01  | Verificar e travar lockfiles (pnpm + python)                                  | ✅ done | critical   | —                              |
| F0-S02  | ESLint + Prettier — instalar e ligar nos workspaces                           | ✅ done | high       | F0-S01                         |
| F0-S03  | Validar boot da API + healthcheck contra Postgres                             | ✅ done | high       | F0-S01                         |
| F0-S03b | Upgrade fastify + vitest (CVE remediation)                                    | ✅ done | high       | F0-S03                         |
| F0-S04  | Drizzle — primeira migration vazia + smoke test                               | ✅ done | high       | F0-S01                         |
| F0-S05  | Web — dev server + design tokens + tela de login placeholder                  | ✅ done | medium     | F0-S01                         |
| F0-S06  | LangGraph service — boot + health + cliente HTTP base                         | ✅ done | high       | F0-S01                         |
| F0-S07  | docker-compose — validação ponta a ponta                                      | ✅ done | high       | F0-S03, F0-S04, F0-S05, F0-S06 |
| F0-S08  | Husky + lint-staged + commitlint                                              | ✅ done | low        | F0-S02                         |
| F0-S10  | Fix scripts/slot.py claim/finish em worktrees do Agent tool                   | ✅ done | high       | —                              |
| F0-S11  | Investigar e corrigir bloco Validação dos slots F2 (Vitest vs Jest)           | ✅ done | medium     | —                              |
| F0-S12  | Investigar staleness do Agent(isolation=worktree) vs commits recentes em main | ✅ done | medium     | —                              |
| F0-S13  | Fix heurística de reconcile-merged (não detecta slots mergeados)              | ✅ done | medium     | —                              |
| F0-S14  | Guard de sincronia entre migrations .sql e \_journal.json do Drizzle          | ✅ done | high       | —                              |

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

| ID     | Título                                                         | Status  | Prioridade | Depende de |
| ------ | -------------------------------------------------------------- | ------- | ---------- | ---------- |
| F3-S00 | LLM Gateway — abstração OpenRouter + fallback Anthropic/OpenAI | ✅ done | critical   | F0-S06     |

## Fase 8 —

| ID     | Título                                                                   | Status    | Prioridade | Depende de                     |
| ------ | ------------------------------------------------------------------------ | --------- | ---------- | ------------------------------ |
| F8-S01 | Backend CRUD agents + agent_cities (admin)                               | ✅ done   | high       | F1-S04, F1-S05, F1-S07         |
| F8-S02 | Frontend gestão de usuários (admin/users)                                | ✅ done   | high       | F1-S07, F1-S08                 |
| F8-S03 | Backend endpoint /api/dashboard/metrics (KPIs agregados)                 | ✅ done   | medium     | F1-S04, F1-S09, F1-S11, F1-S13 |
| F8-S04 | Frontend gestão de agentes de crédito                                    | ✅ done   | high       | F8-S01, F1-S08                 |
| F8-S05 | Frontend dashboard real com KPIs e gráficos                              | 🟣 review | medium     | F8-S03, F1-S08                 |
| F8-S06 | Backend — GET /api/admin/roles + roles na listagem de usuários           | ✅ done   | high       | —                              |
| F8-S07 | Promover roles.scope a coluna real (migration + backfill) e ler do banco | ✅ done   | medium     | F8-S06                         |
