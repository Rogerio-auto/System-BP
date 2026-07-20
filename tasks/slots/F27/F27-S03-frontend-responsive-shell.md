---
id: F27-S03
title: Frontend — shell responsivo (Sidebar→drawer, Topbar mobile, AppLayout fluido)
phase: F27
task_ref: docs/24-pwa.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: []
labels: [frontend, ux, design-system, pwa]
source_docs: [docs/24-pwa.md, docs/18-design-system.md]
docs_required: false
claimed_at: 2026-07-20T13:21:36Z
---

# F27-S03 — Shell responsivo (mobile + desktop)

## Objetivo

Tornar o shell de navegação excelente no mobile sem regredir o desktop: `Sidebar` vira drawer
off-canvas no mobile, `Topbar` compacta, `AppLayout` fluido, alvos de toque ≥44px. Base da onda de
responsividade (superfícies densas ficam no F27-S04).

## Contexto

Doc 24 §6. Alvo travado: desktop **e** mobile igualmente. Hoje a sidebar é fixa. A fonte de
navegação é `apps/web/src/components/layout/app/navigation.ts` (`APP_NAV`/`FOOTER_NAV`) — é a
**fonte única** e o drawer deve consumi-la sem duplicar rotas. Sidebar/Topbar ficam em
`apps/web/src/components/layout/`.

## Escopo (faz)

- `Sidebar` → drawer off-canvas no mobile (overlay + backdrop + fechar por toque/ESC), fixa no
  desktop. Consumir `navigation.ts` como está.
- `Topbar` compacta no mobile (botão de menu abre o drawer; sino permanece acessível).
- `AppLayout` fluido: sem largura fixa que quebre no mobile; respeitar breakpoints do DS v2.
- Alvos de toque ≥44px; foco visível; navegável por teclado.
- Componente de drawer novo em `apps/web/src/components/layout/` se necessário (sem duplicar rotas).

## Fora de escopo (NÃO faz)

- Tabelas densas / cards responsivos de CRM e Relatórios (F27-S04).
- Hoist do `SocketProvider` (F27-S07 — não tocar `App.tsx`).
- Qualquer lógica PWA/SW/push.
- Alterar `navigation.ts` (é fonte única — só consumir).

## Arquivos permitidos

- `apps/web/src/components/layout/**`
- `apps/web/src/**/*.test.ts`
- `apps/web/src/**/*.test.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/App.tsx`
- `apps/web/src/features/**`
- `apps/web/src/components/layout/app/navigation.ts`
- `packages/**`

## Definition of Done

- [ ] Sidebar vira drawer no mobile (overlay, backdrop, fecha por toque/ESC) e permanece fixa no desktop
- [ ] Topbar compacta no mobile abre o drawer; sino continua acessível
- [ ] AppLayout fluido sem overflow horizontal no mobile
- [ ] Alvos de toque ≥44px; foco visível; navegação por teclado
- [ ] `navigation.ts` reusado sem duplicar rotas; tokens do DS v2 (sem cor/spacing hardcoded)
- [ ] Sem regressão do desktop; `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- Não tocar `App.tsx` — o hoist do `SocketProvider` é do F27-S07 e colidiria.
- `navigation.ts` é a fonte única da navegação (memória do projeto: `app/router.tsx` é dead code;
  `navigation.ts` é ativo). Consumir, não duplicar.
  </content>
