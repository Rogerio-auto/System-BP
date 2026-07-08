---
id: F24-S11
title: Frontend — drawer criar/editar regra + test-fire (preview)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: in-progress
priority: high
estimated_size: L
agent_id: null
depends_on: [F24-S05, F24-S10]
blocks: []
labels: [frontend, notifications, admin, design-system]
source_docs: [docs/planejamento-notificacoes.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-08T18:27:08Z
---

# F24-S11 — Frontend: drawer de regra + preview

## Objetivo

Criar o drawer de criação/edição de regra com formulário contextual ao gatilho escolhido e o botão
"Testar (preview)" que mostra destinatários resolvidos e o template renderizado, sem enviar.

## Contexto

Planejamento §5.1. Padrão de drawer = `features/admin/products/ProductDrawer.tsx`. Dropdown carrega
`GET /api/notification-rules/catalog`. Validação client com os schemas de `@elemento/shared-schemas`

- React Hook Form. `POST /:id/test` para o preview.

## Escopo (faz)

- `features/admin/notification-rules/RuleDrawer.tsx` — RHF + zodResolver com `notificationRuleCreateSchema`;
  dropdown do catálogo → campos contextuais (threshold só em `stage_inactivity`), filtros (cidade/produto),
  destinatários (modo + papéis), canais (in_app/email), severidade, cooldown, templates com
  **preview de placeholders permitidos** do gatilho.
- `RuleTestPanel.tsx` — chama `POST /:id/test` (ou endpoint de dry-run) e exibe destinatários + render.
- Estender `api.ts`/`hooks.ts` (create/update/test/catalog).

## Fora de escopo (NÃO faz)

- Lista/card (F24-S10).
- Backend.

## Arquivos permitidos

- `apps/web/src/features/admin/notification-rules/RuleDrawer.tsx`
- `apps/web/src/features/admin/notification-rules/RuleTestPanel.tsx`
- `apps/web/src/features/admin/notification-rules/api.ts`
- `apps/web/src/features/admin/notification-rules/hooks.ts`
- `apps/web/src/pages/admin/Notificacoes.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Drawer cria/edita regra com campos contextuais ao gatilho
- [ ] Validação client com schema compartilhado; placeholders restritos ao gatilho
- [ ] Botão "Testar" mostra destinatários + template renderizado (sem enviar)
- [ ] Tokens do DS; estados de loading/erro/sucesso
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web build
```

## Notas para o agente

- `ProductDrawer.tsx` é a referência de drawer + RHF + mutações.
- Não digitar `trigger_key` livre — só valores do catálogo.
