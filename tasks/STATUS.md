# STATUS — Board de slots

> Atualize esta tabela ao mudar `status` de qualquer slot. Mantenha `STATUS.md` e o frontmatter do slot **sempre sincronizados**.

Legenda: `available` 🟢 · `blocked` ⏸️ · `claimed` 🟡 · `in-progress` 🔵 · `review` 🟣 · `done` ✅ · `cancelled` ⚫

## Resumo

| Fase | Total | 🟢                    | ⏸️  | 🟡  | 🔵  | 🟣  | ✅  |
| ---- | ----- | --------------------- | --- | --- | --- | --- | --- |
| F0   | 9     | 0                     | 1   | 0   | 0   | 7   | 1   |
| F1   | 26    | 11                    | 15  | 0   | 0   | 0   | 0   |
| F2   | —     | a destrinchar após F1 |     |     |     |     |     |
| F3   | —     | a destrinchar         |     |     |     |     |     |
| F4   | —     | a destrinchar         |     |     |     |     |     |
| F5   | —     | a destrinchar         |     |     |     |     |     |
| F6   | —     | a destrinchar         |     |     |     |     |     |
| F7   | —     | a destrinchar         |     |     |     |     |     |

## Fase 0 — Preparação

| ID      | Título                                             | Status         | Prioridade | Depende de      |
| ------- | -------------------------------------------------- | -------------- | ---------- | --------------- |
| F0-S01  | Lockfiles (pnpm + python)                          | ✅ done        | critical   | —               |
| F0-S02  | ESLint + Prettier nos workspaces                   | 🟣 review      | high       | F0-S01          |
| F0-S03  | Boot da API + healthcheck                          | 🟣 review      | high       | F0-S01          |
| F0-S03b | Upgrade fastify + vitest (CVE remediation)         | 🟣 review      | high       | F0-S03          |
| F0-S04  | Drizzle migration inicial                          | 🟣 review      | high       | F0-S01          |
| F0-S05  | Web dev server + design tokens + login placeholder | 🟣 review      | medium     | F0-S01          |
| F0-S06  | LangGraph boot + cliente HTTP base                 | 🟣 review      | high       | F0-S01          |
| F0-S07  | Compose ponta a ponta                              | ⏸️ blocked     | high       | F0-S03,04,05,06 |
| F0-S08  | Husky + lint-staged + commitlint                   | 🟣 review      | low        | F0-S02          |

## Fase 1 — Base operacional

| ID     | Título                                      | Status       | Prioridade | Depende de                     |
| ------ | ------------------------------------------- | ------------ | ---------- | ------------------------------ |
| F1-S01 | Schema identidade                           | 🟢 available | critical   | F0-S04                         |
| F1-S02 | AppError + error handler                    | 🟢 available | high       | F0-S03                         |
| F1-S03 | Auth login/refresh/logout                   | ⏸️ blocked   | critical   | F1-S01, F1-S02                 |
| F1-S04 | Middlewares authenticate + authorize        | ⏸️ blocked   | critical   | F1-S03                         |
| F1-S05 | Schema cities + agents + seed               | 🟢 available | high       | F1-S01                         |
| F1-S06 | CRUD cities                                 | ⏸️ blocked   | medium     | F1-S04, F1-S05                 |
| F1-S07 | CRUD users + roles + scopes                 | ⏸️ blocked   | high       | F1-S04, F1-S05                 |
| F1-S08 | Frontend auth + layout                      | ⏸️ blocked   | critical   | F1-S03, F0-S05                 |
| F1-S09 | Schema leads/customers/history/interactions | ⏸️ blocked   | critical   | F1-S01, F1-S05                 |
| F1-S10 | Helper normalização de telefone             | 🟢 available | high       | —                              |
| F1-S11 | CRUD leads                                  | ⏸️ blocked   | critical   | F1-S04, F1-S09, F1-S10, F1-S15 |
| F1-S12 | Frontend CRM                                | ⏸️ blocked   | high       | F1-S08, F1-S11                 |
| F1-S13 | Schema + service kanban                     | ⏸️ blocked   | high       | F1-S04, F1-S09                 |
| F1-S14 | Frontend Kanban                             | ⏸️ blocked   | medium     | F1-S08, F1-S13                 |
| F1-S15 | Outbox pattern                              | 🟢 available | critical   | F0-S04                         |
| F1-S16 | Audit logs                                  | 🟢 available | high       | F1-S01                         |
| F1-S17 | Pipeline de importação                      | ⏸️ blocked   | high       | F1-S11, F1-S15                 |
| F1-S18 | Frontend importação                         | ⏸️ blocked   | medium     | F1-S17                         |
| F1-S19 | Webhook WhatsApp                            | 🟢 available | high       | F1-S15                         |
| F1-S20 | Cliente Chatwoot                            | 🟢 available | medium     | F0-S03                         |
| F1-S21 | Webhook Chatwoot                            | ⏸️ blocked   | medium     | F1-S20, F1-S15                 |
| F1-S22 | Sync atributos Chatwoot                     | ⏸️ blocked   | medium     | F1-S20, F1-S15, F1-S11         |
| F1-S23 | Feature flags (4 camadas)                   | 🟢 available | high       | F1-S04                         |
| F1-S24 | LGPD baseline — cifração PII + Pino redact  | ⏸️ blocked   | critical   | F1-S01, F1-S09                 |
| F1-S25 | LGPD — direitos do titular + retenção       | ⏸️ blocked   | high       | F1-S16, F1-S15, F1-S24         |
| F1-S26 | LGPD — DLP no pipeline LangGraph            | ⏸️ blocked   | critical   | F0-S06                         |

## Fases 2–7

Cada fase será destrinchada em slots ao se aproximar a sua execução, seguindo o padrão de F0 e F1. As tasks técnicas em [docs/12-tasks-tecnicas.md](../docs/12-tasks-tecnicas.md) servem de base — cada `T<X.Y>` vira 1 ou mais slots.

Quando F1 atingir ~80% de conclusão, abrir slots de **F2 — Crédito e simulação** (T2.1 a T2.8 → ~10 slots).
