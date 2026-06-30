---
id: F24-S12
title: Frontend — preferências de notificação do usuário (categoria × canal)
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S09]
blocks: []
labels: [frontend, notifications, design-system]
source_docs: [docs/planejamento-notificacoes.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/guias/notificacoes-preferencias.mdx]
claimed_at: 2026-06-30T21:00:23Z
completed_at: 2026-06-30T21:18:10Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/398

---
# F24-S12 — Frontend: preferências do usuário

## Objetivo

Adicionar a seção "Notificações" na aba Conta de `/configuracoes`: matriz categoria × canal
(in-app/email) com toggles + mute global, consumindo a API de F24-S09.

## Contexto

Planejamento §5.2. Padrão = `features/configuracoes/ContaSection.tsx` (`SectionCard`). Default
opt-out (tudo ligado). Categorias do enum compartilhado (`@elemento/shared-schemas`).

## Escopo (faz)

- Nova `SectionCard` "Notificações" em `ContaSection.tsx` (ou componente dedicado importado nela).
- `features/notifications/preferences/{api.ts,hooks.ts,PreferencesMatrix.tsx}` — GET/PUT da matriz;
  toggles por categoria × canal; switch de mute global; salvar otimista com rollback em erro.
- `docs/help/guias/notificacoes-preferencias.mdx`.

## Fora de escopo (NÃO faz)

- Admin de regras (F24-S10/S11).
- Sino em tempo real (F24-S13).
- Quiet hours / digest.

## Arquivos permitidos

- `apps/web/src/features/configuracoes/ContaSection.tsx`
- `apps/web/src/features/notifications/preferences/api.ts`
- `apps/web/src/features/notifications/preferences/hooks.ts`
- `apps/web/src/features/notifications/preferences/PreferencesMatrix.tsx`
- `docs/help/guias/notificacoes-preferencias.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Seção "Notificações" na aba Conta com matriz categoria × canal + mute global
- [ ] Default opt-out; salvar otimista com rollback
- [ ] Categorias do enum compartilhado (sem hardcode divergente)
- [ ] MDX válido; tokens do DS
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web build
```

## Notas para o agente

- `ContaSection.tsx` já tem o padrão `SectionCard` (Perfil/Segurança/Aparência) — replicar.
- MDX sem sintaxe inválida; rodar teste do manifest do web se tocar help.
