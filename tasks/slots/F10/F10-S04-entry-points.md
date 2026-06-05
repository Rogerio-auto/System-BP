---
id: F10-S04
title: Entry points — botão "?" na topbar + "Ajuda" no rodapé da sidebar
phase: F10
task_ref: docs/20-central-de-ajuda.md#1
status: done
priority: high
estimated_size: XS
agent_id: null
claimed_at: null
completed_at: 2026-06-05T18:10:17Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/186
depends_on: [F10-S03]
blocks: []
source_docs:
  - docs/20-central-de-ajuda.md#1
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F10-S04 — Entry points

## Objetivo

Tornar a Central de Ajuda descobrível por usuários que não conhecem o atalho Cmd+K. Dois pontos de entrada (decisão travada na conversa de plano):

1. Botão "?" na topbar (estilo Stripe — sempre visível, contextual).
2. Item "Ajuda" no rodapé da sidebar (estilo ClickUp — navegação tradicional).

## Contexto

F10-S03 entregou o palette + atalho. Mas atalho sem UI visível não é descoberto pelo operador médio do Banco do Povo. Este slot é o casamento do entry-point com o conteúdo que vem em S05+.

## Escopo (faz)

- Cria `apps/web/src/features/help/help-palette-store.ts` — store zustand mínimo com `{ open: boolean, openPalette(), closePalette(), togglePalette() }`. Substitui o estado local que vivia no shell do SearchPalette.
- Refatora `SearchPalette.tsx` para consumir o store (em vez de useState próprio). Mantém o lazy-load behavior — só carrega o impl após primeira interação.
- Adiciona botão "?" na topbar (componente `HelpButton.tsx` local em `apps/web/src/features/help/`). Posição: à esquerda do `ThemeToggle`. Tooltip nativo via `title`. Chama `togglePalette()`.
- Adiciona entrada `Ajuda` ao `FOOTER_NAV` em `apps/web/src/app/navigation.ts`. iconKey `help`.
- Adiciona `IconHelp` + entrada `help` ao `ICON_MAP` em `Sidebar.tsx`.

## Fora de escopo (NÃO faz)

- Telemetria de cliques no entry-point — F10-S12.
- Tour de primeiro acesso (overlay com setas) — F11.
- Mudar o look do palette — F10-S03 já travou.
- Conteúdo das páginas — F10-S05+.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/help/SearchPalette.tsx`
- `apps/web/src/features/help/help-palette-store.ts` (criar)
- `apps/web/src/features/help/HelpButton.tsx` (criar)
- `apps/web/src/components/layout/Topbar.tsx` (apenas adicionar o `<HelpButton />`)
- `apps/web/src/components/layout/Sidebar.tsx` (apenas registrar o iconKey `help` no `ICON_MAP`)
- `apps/web/src/app/navigation.ts` (apenas adicionar entrada ao `FOOTER_NAV`)
- `tasks/slots/F10/F10-S04-entry-points.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/SearchPaletteImpl.tsx` — escopo de S03, não tocar.
- Qualquer `apps/web/src/features/**` que não seja `help/`.
- `apps/api/**`, `apps/langgraph-service/**`, `packages/**`.
- `tasks/STATUS.md`.

## Contratos de entrada

- F10-S03 entregue: `SearchPalette` shell com atalho global, `SearchPaletteImpl` lazy-loaded.
- `zustand` já é dependência (`apps/web/package.json`).

## Contratos de saída

- Botão "?" na topbar abre o palette em qualquer rota autenticada.
- Cmd+K continua funcionando (não regride).
- Item "Ajuda" aparece no rodapé da sidebar, acima de Configurações ou abaixo (decisão estética — ordem é livre).
- Clicar em "Ajuda" navega para `/ajuda`.
- Em modo colapsado da sidebar, "Ajuda" mostra apenas o ícone com tooltip nativo.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde (incluindo qualquer teste novo)
- [ ] `pnpm --filter @elemento/web build` verde com main bundle ≤ baseline + 2 KB gzipped
- [ ] Botão "?" visível na topbar em dev e abre o palette
- [ ] "Ajuda" visível no rodapé da sidebar em dev e leva a `/ajuda`

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Store zustand:** seguir o padrão do `useSidebarStore` em `AppLayout.tsx`. Sem persist — palette state é efêmero.
- **HelpButton:** mesmo tamanho de `ThemeToggle` para alinhamento visual. SVG question-mark-circle 20×20.
- **`tsx-help-button`:** atributo `data-help-button` no botão pra eventualmente tutorial (F11) ancorar setas.
- **Tooltip do "?":** `title="Buscar na ajuda (Ctrl+K)"` — comunica o atalho.
- **Permission gate:** não precisa. Ajuda é pública pra qualquer autenticado.
- **Acessibilidade:** `aria-label="Buscar na ajuda"` no botão. Sidebar item já tem `aria-current` via NavLink.
