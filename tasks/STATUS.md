# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 9     | 0   | 0   | 0   | 0   | 0   | 9   |
| F1   | 28    | 1   | 3   | 0   | 0   | 2   | 22  |
| F3   | 1     | 0   | 0   | 0   | 0   | 0   | 1   |

## Fase 0 — Preparação

| ID      | Título                                                       | Status  | Prioridade | Depende de                     |
| ------- | ------------------------------------------------------------ | ------- | ---------- | ------------------------------ |
| F0-S01  | Verificar e travar lockfiles (pnpm + python)                 | ✅ done | critical   | —                              |
| F0-S02  | ESLint + Prettier — instalar e ligar nos workspaces          | ✅ done | high       | F0-S01                         |
| F0-S03  | Validar boot da API + healthcheck contra Postgres            | ✅ done | high       | F0-S01                         |
| F0-S03b | Upgrade fastify + vitest (CVE remediation)                   | ✅ done | high       | F0-S03                         |
| F0-S04  | Drizzle — primeira migration vazia + smoke test              | ✅ done | high       | F0-S01                         |
| F0-S05  | Web — dev server + design tokens + tela de login placeholder | ✅ done | medium     | F0-S01                         |
| F0-S06  | LangGraph service — boot + health + cliente HTTP base        | ✅ done | high       | F0-S01                         |
| F0-S07  | docker-compose — validação ponta a ponta                     | ✅ done | high       | F0-S03, F0-S04, F0-S05, F0-S06 |
| F0-S08  | Husky + lint-staged + commitlint                             | ✅ done | low        | F0-S02                         |

## Fase 1 — Base operacional

| ID     | Título                                                                                  | Status       | Prioridade | Depende de                     |
| ------ | --------------------------------------------------------------------------------------- | ------------ | ---------- | ------------------------------ |
| F1-S01 | Schema identidade — orgs, users, roles, permissions, sessions, city scopes              | ✅ done      | critical   | F0-S04                         |
| F1-S02 | Helpers de erro e resposta padronizados                                                 | ✅ done      | high       | F0-S03                         |
| F1-S03 | Auth — login, refresh, logout                                                           | ✅ done      | critical   | F1-S01, F1-S02                 |
| F1-S04 | Middlewares authenticate + authorize com escopo de cidade                               | ✅ done      | critical   | F1-S03                         |
| F1-S05 | Schema cities + agents + seed cidades de Rondônia                                       | ✅ done      | high       | F1-S01                         |
| F1-S06 | CRUD cities (admin)                                                                     | ⏸️ blocked   | medium     | F1-S04, F1-S05                 |
| F1-S07 | CRUD users + assign roles + city scopes                                                 | ✅ done      | high       | F1-S04, F1-S05                 |
| F1-S08 | Frontend — login real + hook useAuth + layout autenticado                               | ✅ done      | critical   | F1-S03, F0-S05                 |
| F1-S09 | Schema leads + customers + history + interactions                                       | ✅ done      | critical   | F1-S01, F1-S05                 |
| F1-S10 | Helper de normalização de telefone (E.164 BR)                                           | ✅ done      | high       | —                              |
| F1-S11 | CRUD leads (manual) com escopo de cidade + dedupe + eventos                             | ✅ done      | critical   | F1-S04, F1-S09, F1-S10, F1-S15 |
| F1-S12 | Frontend CRM — lista + detalhe + form de lead                                           | ✅ done      | high       | F1-S08, F1-S11                 |
| F1-S13 | Schema kanban + service de transições válidas                                           | ✅ done      | high       | F1-S04, F1-S09                 |
| F1-S14 | Frontend Kanban (board + detalhe modal)                                                 | ✅ done      | medium     | F1-S08, F1-S13                 |
| F1-S15 | Outbox — schema + emit() + worker outbox-publisher                                      | ✅ done      | critical   | F0-S04                         |
| F1-S16 | Audit logs — schema + helper auditLog()                                                 | ✅ done      | high       | F1-S01                         |
| F1-S17 | Pipeline de importação genérico (com adapter de leads)                                  | 🟢 available | high       | F1-S11, F1-S15                 |
| F1-S18 | Frontend importação — wizard 4 passos                                                   | ⏸️ blocked   | medium     | F1-S17                         |
| F1-S19 | Webhook WhatsApp — entrada + idempotência + persistência                                | ✅ done      | high       | F1-S15                         |
| F1-S20 | Cliente HTTP Chatwoot                                                                   | ✅ done      | medium     | F0-S03                         |
| F1-S21 | Webhook Chatwoot — entrada + idempotência                                               | ⏸️ blocked   | medium     | F1-S20, F1-S15                 |
| F1-S22 | Sync de atributos do Chatwoot (handler de eventos)                                      | 🟣 review    | medium     | F1-S20, F1-S15, F1-S11         |
| F1-S23 | Feature flags — schema + admin UI + middleware backend + hook frontend                  | ✅ done      | high       | F1-S04                         |
| F1-S24 | LGPD baseline — cifração de PII em coluna + hash HMAC + Pino redact                     | ✅ done      | critical   | F1-S01, F1-S09                 |
| F1-S25 | LGPD — direitos do titular (acesso/portabilidade/revogação/correção) + jobs de retenção | ✅ done      | high       | F1-S16, F1-S15, F1-S24         |
| F1-S26 | LGPD — DLP no pipeline LangGraph (mascaramento antes do gateway OpenRouter)             | ✅ done      | critical   | F0-S06                         |
| F1-S27 | Fix encadeamento .using('gin') em schemas Drizzle (cities, leads)                       | ✅ done      | critical   | —                              |
| F1-S28 | Fix typecheck do api — drizzle.config.ts fora de rootDir                                | 🟣 review    | critical   | F1-S27                         |

## Fase 3 — Agentes IA

| ID     | Título                                                         | Status  | Prioridade | Depende de |
| ------ | -------------------------------------------------------------- | ------- | ---------- | ---------- |
| F3-S00 | LLM Gateway — abstração OpenRouter + fallback Anthropic/OpenAI | ✅ done | critical   | F0-S06     |
