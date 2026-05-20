---
id: F9-S02
title: Backend — API read de ai_decision_logs (lista + timeline, city-scoped)
phase: F9
task_ref: T9.2
status: done
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-19T23:17:29Z
completed_at: 2026-05-19T23:40:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/116
depends_on: [F3-S01, F9-S00, F1-S04]
blocks: [F9-S06]
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md
  - docs/17-lgpd-protecao-dados.md
---

# F9-S02 — Backend: API read de `ai_decision_logs`

## Objetivo

Expor `ai_decision_logs` como API read-only para o viewer de decisões do Console de IA, com escopo de cidade aplicado via lead e masking defensivo de PII na resposta.

## Escopo

- `apps/api/src/modules/ai-console/decisions/`:
  - `repository.ts` — queries com `applyCityScope` (JOIN com `leads` quando `lead_id IS NOT NULL`; para `lead_id IS NULL`, restringir a admin/gestor_geral via flag de bypass explícita testada).
  - `service.ts` — aplica masking defensivo na coluna `decision` jsonb antes de retornar (regex de telefone/CPF/email; mesmo `decision` já sendo proibida de carregar PII bruta — defesa em profundidade). Para cada decisão com `tokens_in`/`tokens_out` não-nulos, calcula `cost_usd` e `cost_brl` via `priceModelTokens()` (helper de F9-S00) consultando `model_pricing`. Modelos sem entry em `model_pricing` retornam `cost_usd: null` / `cost_brl: null` (F9-S06 mostra "—").
  - `controller.ts`, `schemas.ts`, `routes.ts`, `index.ts`.
  - `__tests__/decisions.routes.test.ts` — RBAC (admin / gestor_geral / gestor_regional com city-scope / agente sem permissão); testa que decisão de lead fora do escopo retorna 404 (não 403); testa masking defensivo (decisão com CPF injetado em `decision` jsonb não vaza na resposta).
- `apps/api/src/app.ts` — registra plugin sob `/api/ai-console/decisions`.

## Rotas

- `GET /api/ai-console/decisions?conversation_id?&lead_id?&intent?&node?&from?&to?&limit?&cursor?` — lista paginada (`ai_decisions:read`).
- `GET /api/ai-console/decisions/conversations/:conversationId` — timeline cronológica da conversa (`ai_decisions:read`).

## Permissões e escopo (doc 10 §3.2)

| Quem              | Acesso                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`           | Tudo (com e sem `lead_id`)                                                                                                                                                        |
| `gestor_geral`    | Tudo (com e sem `lead_id`)                                                                                                                                                        |
| `gestor_regional` | Apenas decisões cujo `lead.city_id` está em `user_city_scopes`. Decisões com `lead_id IS NULL` (pré-identificação) **não** são retornadas a este papel — filtradas no repository. |
| Demais            | 403                                                                                                                                                                               |

## Masking defensivo

- Antes de serializar a resposta, aplicar regex de CPF (`\d{3}\.?\d{3}\.?\d{3}-?\d{2}`), telefone (E.164 e nacional), email à coluna `decision` jsonb. Match → substituir por placeholder `<masked>`.
- Justificativa em [doc 17 §8.4.1](../../../docs/17-lgpd-protecao-dados.md). O `decision` JÁ é proibido de carregar PII bruta — esta camada é defesa em profundidade contra regressão.
- Teste obrigatório: inserir um log com CPF "injetado" em `decision` (via mock), confirmar que a resposta da API mostra `<masked>`.

## LGPD / Segurança

- Label `lgpd-impact` aplicado ao PR. Checklist do doc 17 §14.2 obrigatório.
- Nenhum write nessa API (`ai_decision_logs` é append-only — sem DELETE/PATCH/PUT).
- Logs do controller carregam apenas IDs opacos; sem ecoar `decision` no log.
- Sem evento outbox (read-only).

## Fora de escopo

- Frontend (F9-S06). Mutação de logs (proibida — tabela append-only). Retenção (job já existe ou em backlog).

## Arquivos permitidos

- `apps/api/src/modules/ai-console/decisions/repository.ts`
- `apps/api/src/modules/ai-console/decisions/service.ts`
- `apps/api/src/modules/ai-console/decisions/controller.ts`
- `apps/api/src/modules/ai-console/decisions/schemas.ts`
- `apps/api/src/modules/ai-console/decisions/routes.ts`
- `apps/api/src/modules/ai-console/decisions/index.ts`
- `apps/api/src/modules/ai-console/decisions/__tests__/decisions.routes.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/db/seed/permissions.ts` (adicionar `ai_decisions:read` + atribuir conforme matriz)

## Definition of Done

- [ ] Rotas implementadas com Zod nas bordas.
- [ ] Escopo de cidade aplicado via JOIN com leads no repository, não no controller.
- [ ] Masking defensivo aplicado e testado com PII injetada em fixture.
- [ ] Gestor regional não vê decisões fora do escopo (404, não 403).
- [ ] Decisões `lead_id IS NULL` restritas a admin/gestor_geral, testado.
- [ ] Permissão `ai_decisions:read` no seed + atribuição.
- [ ] `cost_usd`/`cost_brl` calculados e retornados por decisão; `null` quando o modelo não tem entry em `model_pricing` (testado).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` verdes.
- [ ] PR com label `lgpd-impact` e checklist §14.2 preenchido.

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- ai-console/decisions
```
