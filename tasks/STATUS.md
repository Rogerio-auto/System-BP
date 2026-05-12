# STATUS — Board de slots

> Atualize via `python scripts/slot.py sync` (NÃO edite à mão — slot frontmatters são a fonte da verdade).

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢  | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --- | --- | --- | --- | --- | --- |
| F0   | 9     | 1   | 0   | 0   | 0   | 0   | 8   |
| F1   | 26    | 11  | 15  | 0   | 0   | 0   | 0   |
| F3   | 1     | 1   | 0   | 0   | 0   | 0   | 0   |

## Fase 0 — Preparação

| ID      | Título                                                       | Status       | Prioridade | Depende de                     |
| ------- | ------------------------------------------------------------ | ------------ | ---------- | ------------------------------ |
| F0-S01  | Verificar e travar lockfiles (pnpm + python)                 | ✅ done      | critical   | —                              |
| F0-S02  | ESLint + Prettier — instalar e ligar nos workspaces          | ✅ done      | high       | F0-S01                         |
| F0-S03  | Validar boot da API + healthcheck contra Postgres            | ✅ done      | high       | F0-S01                         |
| F0-S03b | Upgrade fastify + vitest (CVE remediation)                   | ✅ done      | high       | F0-S03                         |
| F0-S04  | Drizzle — primeira migration vazia + smoke test              | ✅ done      | high       | F0-S01                         |
| F0-S05  | Web — dev server + design tokens + tela de login placeholder | ✅ done      | medium     | F0-S01                         |
| F0-S06  | LangGraph service — boot + health + cliente HTTP base        | ✅ done      | high       | F0-S01                         |
| F0-S07  | docker-compose — validação ponta a ponta                     | 🟢 available | high       | F0-S03, F0-S04, F0-S05, F0-S06 |
| F0-S08  | Husky + lint-staged + commitlint                             | ✅ done      | low        | F0-S02                         |

## Fase 1 — Base operacional

| ID     | Título                                                                                  | Status       | Prioridade | Depende de                     |
| ------ | --------------------------------------------------------------------------------------- | ------------ | ---------- | ------------------------------ |
| F1-S01 | Schema identidade — orgs, users, roles, permissions, sessions, city scopes              | 🟢 available | critical   | F0-S04                         |
| F1-S02 | Helpers de erro e resposta padronizados                                                 | 🟢 available | high       | F0-S03                         |
| F1-S03 | Auth — login, refresh, logout                                                           | 🟢 available | critical   | F1-S01, F1-S02                 |
| F1-S04 | Middlewares authenticate + authorize com escopo de cidade                               | 🟢 available | critical   | F1-S03                         |
| F1-S05 | Schema cities + agents + seed cidades de Rondônia                                       | 🟢 available | high       | F1-S01                         |
| F1-S06 | CRUD cities (admin)                                                                     | ⏸️ blocked   | medium     | F1-S04, F1-S05                 |
| F1-S07 | CRUD users + assign roles + city scopes                                                 | ⏸️ blocked   | high       | F1-S04, F1-S05                 |
| F1-S08 | Frontend — login real + hook useAuth + layout autenticado                               | ⏸️ blocked   | critical   | F1-S03, F0-S05                 |
| F1-S09 | Schema leads + customers + history + interactions                                       | ⏸️ blocked   | critical   | F1-S01, F1-S05                 |
| F1-S10 | Helper de normalização de telefone (E.164 BR)                                           | 🟢 available | high       | —                              |
| F1-S11 | CRUD leads (manual) com escopo de cidade + dedupe + eventos                             | ⏸️ blocked   | critical   | F1-S04, F1-S09, F1-S10, F1-S15 |
| F1-S12 | Frontend CRM — lista + detalhe + form de lead                                           | ⏸️ blocked   | high       | F1-S08, F1-S11                 |
| F1-S13 | Schema kanban + service de transições válidas                                           | ⏸️ blocked   | high       | F1-S04, F1-S09                 |
| F1-S14 | Frontend Kanban (board + detalhe modal)                                                 | ⏸️ blocked   | medium     | F1-S08, F1-S13                 |
| F1-S15 | Outbox — schema + emit() + worker outbox-publisher                                      | 🟢 available | critical   | F0-S04                         |
| F1-S16 | Audit logs — schema + helper auditLog()                                                 | 🟢 available | high       | F1-S01                         |
| F1-S17 | Pipeline de importação genérico (com adapter de leads)                                  | ⏸️ blocked   | high       | F1-S11, F1-S15                 |
| F1-S18 | Frontend importação — wizard 4 passos                                                   | ⏸️ blocked   | medium     | F1-S17                         |
| F1-S19 | Webhook WhatsApp — entrada + idempotência + persistência                                | 🟢 available | high       | F1-S15                         |
| F1-S20 | Cliente HTTP Chatwoot                                                                   | 🟢 available | medium     | F0-S03                         |
| F1-S21 | Webhook Chatwoot — entrada + idempotência                                               | ⏸️ blocked   | medium     | F1-S20, F1-S15                 |
| F1-S22 | Sync de atributos do Chatwoot (handler de eventos)                                      | ⏸️ blocked   | medium     | F1-S20, F1-S15, F1-S11         |
| F1-S23 | Feature flags — schema + admin UI + middleware backend + hook frontend                  | 🟢 available | high       | F1-S04                         |
| F1-S24 | LGPD baseline — cifração de PII em coluna + hash HMAC + Pino redact                     | ⏸️ blocked   | critical   | F1-S01, F1-S09                 |
| F1-S25 | LGPD — direitos do titular (acesso/portabilidade/revogação/correção) + jobs de retenção | ⏸️ blocked   | high       | F1-S16, F1-S15, F1-S24         |
| F1-S26 | LGPD — DLP no pipeline LangGraph (mascaramento antes do gateway OpenRouter)             | ⏸️ blocked   | critical   | F0-S06                         |

## Fase 3 — Agentes IA

| ID     | Título                                                         | Status       | Prioridade | Depende de |
| ------ | -------------------------------------------------------------- | ------------ | ---------- | ---------- |
| F3-S00 | LLM Gateway — abstração OpenRouter + fallback Anthropic/OpenAI | 🟢 available | critical   | F0-S06     |
