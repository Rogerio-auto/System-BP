---
id: F24-S10
title: Frontend — página Admin de regras de notificação (lista + card)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: [F24-S05]
blocks: [F24-S11]
labels: [frontend, notifications, admin, design-system]
source_docs: [docs/planejamento-notificacoes.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/guias/admin/notificacoes.mdx]
claimed_at: 2026-06-30T22:22:13Z
completed_at: 2026-06-30T22:42:48Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/403
---

# F24-S10 — Frontend: página Admin (lista de regras)

## Objetivo

Criar a página `/admin/notificacoes` com a lista de regras de notificação e o card de acesso na
`ConfiguracoesPage`, gated por `notifications:manage`, usando os tokens do Design System.

## Contexto

Planejamento §5.1. Padrão de página admin = `pages/admin/FeatureFlags.tsx` / `pages/admin/Products.tsx`

- `features/admin/products/*`. Rota nova entra em `App.tsx` (roteador real). Card entra em
  `ConfiguracoesPage.tsx` (grupo Administração técnica) gated por `hasPermission('notifications:manage')`.
  Consome a API de F24-S05 com schema de `@elemento/shared-schemas`.

## Escopo (faz)

- `pages/admin/Notificacoes.tsx` — lista (nome, gatilho, categoria, canais, severidade, enabled,
  última execução), toggle enabled inline, botão "Nova regra" e ações editar/excluir.
- `features/admin/notification-rules/{api.ts,hooks.ts,RuleList.tsx}` — TanStack Query + tipos do shared-schemas.
- Rota em `App.tsx`; card em `ConfiguracoesPage.tsx` (ícone SVG inline, `var(--elev-*)`, hover Lift).
- `docs/help/guias/admin/notificacoes.mdx` — guia do usuário admin.

## Fora de escopo (NÃO faz)

- Drawer de criar/editar (F24-S11).
- Preferências do usuário (F24-S12).
- Sino em tempo real (F24-S13).

## Arquivos permitidos

- `apps/web/src/pages/admin/Notificacoes.tsx`
- `apps/web/src/features/admin/notification-rules/api.ts`
- `apps/web/src/features/admin/notification-rules/hooks.ts`
- `apps/web/src/features/admin/notification-rules/RuleList.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`
- `docs/help/guias/admin/notificacoes.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Página `/admin/notificacoes` lista regras com toggle enabled e ações
- [ ] Card na ConfiguracoesPage gated por `notifications:manage`
- [ ] Consome schema de `@elemento/shared-schemas` (sem drift)
- [ ] Tokens do DS (profundidade, hover, tipografia) — nada hardcoded fora dos tokens
- [ ] `docs/help/guias/admin/notificacoes.mdx` válido (mdx compila)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web build
```

## Notas para o agente

- `App.tsx` é o roteador real; rota admin usa `/admin/*`.
- Ler o schema Zod real da API (shared-schemas) para casar casing/envelope (evita drift front×API).
- MDX: sem sintaxe inválida (`{#anchor}`, `{{1}}`) — rodar o teste do manifest do web se tocar help.
