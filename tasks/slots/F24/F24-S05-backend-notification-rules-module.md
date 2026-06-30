---
id: F24-S05
title: Backend — módulo notification-rules (CRUD admin + RBAC + test-fire)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: available
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S01, F24-S02, F24-S04]
blocks: [F24-S06, F24-S07, F24-S10]
labels: [backend, notifications, rbac, multi-tenant, lgpd-impact]
source_docs: [docs/planejamento-notificacoes.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F24-S05 — Backend: módulo notification-rules

## Objetivo

Criar o módulo `notification-rules` com CRUD administrativo das regras, protegido por
`notifications:manage`, org-scoped, validado por Zod (schemas de F24-S04), com auditoria e um
endpoint **test-fire/preview** que resolve destinatários e renderiza o template **sem enviar**.

## Contexto

Planejamento §4.2/§4.4/§5.1. Seguir o padrão de `modules/credit-products/*`
(routes+controller+service+repository). `featureGate('notifications.rules.enabled')` nas rotas.
Resolução de destinatários reusa o padrão de `resolveTaskCreatedRecipients` (join `user_city_scopes`).
Registrar o módulo no bootstrap (`app.ts`).

## Escopo (faz)

- `modules/notification-rules/{routes,controller,service,repository}.ts`:
  - `GET /api/notification-rules` (lista da org), `POST` (cria), `GET /:id`, `PATCH /:id`, `DELETE /:id`.
  - `POST /api/notification-rules/:id/test` — resolve destinatários + renderiza template (preview), sem enviar.
  - `GET /api/notification-rules/catalog` — devolve `TRIGGER_CATALOG` (para o dropdown do front).
- RBAC `authorize({ permissions: ['notifications:manage'] })`, org-scope em toda query,
  validação Zod request/response, auditoria (`action: 'notification_rule.created|updated|deleted'`, sem PII),
  idempotência no POST (idempotency key).
- Helper de resolução de destinatários reutilizável (export para F24-S06/S07).
- Registro do módulo em `app.ts`.

## Fora de escopo (NÃO faz)

- Disparo real por evento (F24-S06) ou por inatividade (F24-S07).
- Preferências de usuário (F24-S09).
- UI (F24-S10/S11).

## Arquivos permitidos

- `apps/api/src/modules/notification-rules/routes.ts`
- `apps/api/src/modules/notification-rules/controller.ts`
- `apps/api/src/modules/notification-rules/service.ts`
- `apps/api/src/modules/notification-rules/repository.ts`
- `apps/api/src/modules/notification-rules/recipients.ts`
- `apps/api/src/modules/notification-rules/__tests__/notification-rules.test.ts`
- `apps/api/src/app.ts`
- `packages/shared-schemas/src/notification-rules.ts`
- `packages/shared-schemas/src/index.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/handlers/**`
- `apps/api/src/workers/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] CRUD completo com RBAC `notifications:manage` + org-scope + Zod + audit + idempotência
- [ ] `featureGate('notifications.rules.enabled')` nas rotas
- [ ] Endpoint `test` resolve destinatários e renderiza preview sem enviar
- [ ] Endpoint `catalog` expõe o catálogo
- [ ] Helper de destinatários reutilizável exportado
- [ ] Testes de isolamento por papel/org + test-fire
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes; checklist LGPD §14.2 no PR

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F24-S05
```

## Notas para o agente

- `modules/credit-products/*` é a referência canônica de CRUD admin + scope + audit.
- Destinatários `by_role_city` → join `user_city_scopes`; `assignee` → `kanban_cards.assignee_user_id`;
  `managers` → admin/gestor_geral da org. Nunca cruzar org.
- Sem `any`/`as` não justificado.

### Reconciliação de contrato (apontado no security-review de F24-S04 — RESOLVER AQUI)

O `notification_rules` (DB, F24-S01) e o schema Zod (F24-S04) divergem. Ajuste o schema compartilhado E o service para casar com o DB:

1. **B-07 — `name` e `cooldown_hours` faltam no schema.** O DB tem `name text NOT NULL` e `cooldown_hours int NOT NULL DEFAULT 0`. Adicione `name` (obrigatório, exibido na lista do Admin) e `cooldown_hours` (opcional, default 0) aos schemas create/update/response.
2. **B-08 — `city_scope` ↔ `filters` jsonb.** O schema expõe `city_scope` mas o DB guarda em `filters` jsonb. Mapeie no repository/service: `city_scope` (entrada/resposta) ⇄ `filters->>'city_scope'` (persistência). A resposta deve refletir o que está em `filters`.
3. **`recipient_role` (schema) vs `recipient_roles text[]` (DB).** Reconcilie o nome/cardinalidade — o DB é array. Use o array.
4. **`category`.** Não vem no create schema do admin: **derive do catálogo** (`TRIGGER_CATALOG[trigger_key].category`) no service e persista em `notification_rules.category` (usado depois por preferências/fan-out).
5. **B-06 — validação de placeholders no update.** Quando `title_template`/`body_template` vierem sem `trigger_key` no payload de update, busque o `trigger_key` atual da regra no DB e re-valide os placeholders contra ele (não aceite placeholder fora do catálogo do gatilho).
6. `enabled` no DB default false (regras nascem desligadas) — respeite o que o admin enviar.
