---
id: F16-S31
title: UI livechat — bubble/composer responsivos sem espremer + scrollbar custom
phase: F16
task_ref: docs/18-design-system.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-18T00:17:00Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
docs_required: false
docs_audience:
  - dev
docs_artifacts: []
---

# F16-S31 — Bubble/composer responsivos + scrollbar custom

## Objetivo

Acabar com o texto "espremido" e a quebra feia de palavras no chat quando a tela muda de
dimensão, e substituir a barra de scroll nativa (que se destaca demais) por uma scrollbar
custom sutil, alinhada ao Design System (doc 18), em todo o sistema.

## Contexto (diagnóstico 2026-06-17)

- **Layout espreme a coluna do meio:** `ConversationsLayout.tsx` tem ChatList `width: 280px` e
  ContactPanel `width: 240px` **fixos** (`flex-shrink-0`); a conversa é `flex-1 min-w-0`. Numa
  janela ~800px sobra ~280px pro chat → o bubble `max-w-[75%]` (TextBubble) vira ~210px → cada
  palavra quebra. `min-w-0` evita overflow mas deixa afinar demais.
- **Bubbles** já usam `whitespace-pre-wrap break-words` (correto) — o problema é a LARGURA do
  container, não a classe de quebra.
- **Scrollbar:** não existe nenhuma estilização (`grep scrollbar` → 0). Usa a nativa do OS.

## Escopo (faz)

- **Layout responsivo (`ConversationsLayout.tsx`):** abaixo de um breakpoint intermediário
  (ex: `< 1024px`), **colapsar o ContactPanel** (240px) com um toggle (botão "info"/perfil no
  header da conversa) para devolver largura ao chat. Manter o comportamento mobile existente
  (`max-width: 767px` → ChatList 100%). Garantir que a coluna da conversa nunca afine abaixo de
  um mínimo legível (ex: `min-width` razoável no `<main>`).
- **Bubble (`bubbles/*.tsx`, principalmente TextBubble):** largura máxima mais robusta — algo como
  `max-w-[min(75%,40rem)]` e um piso de leitura (não deixar o bubble virar coluna de 1 palavra).
  Manter `break-words` (não usar `break-all`, que quebra no meio da palavra). Para URLs/strings
  longas sem espaço, permitir quebra controlada sem destruir o texto normal.
- **Composer (`MessageComposer.tsx`):** garantir `min-width: 0` nos itens flex e que a textarea
  cresça/encolha sem espremer ícones/botões nem quebrar o layout ao redimensionar; respeitar a
  área de digitação (sem cortar/espremer o texto digitado).
- **Scrollbar custom (global, `styles/globals.css`):** estilizar `::-webkit-scrollbar*` +
  `scrollbar-width`/`scrollbar-color` (Firefox) com tokens do DS — fina, discreta, thumb com
  `var(--border)`/surface, track transparente, cantos arredondados, hover sutil. Aplica ao sistema
  todo (o usuário reclamou que a nativa "se destaca demais"). Respeitar light/dark.

## Fora de escopo (NÃO faz)

- Mudar a lógica de mensagens/tempo real (já resolvido em F16-S25..S27 + hotfixes).
- Redesenhar o ChatList ou o ContactPanel além do colapso responsivo.
- Backend.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/ConversationsLayout.tsx`
- `apps/web/src/features/conversations/components/MessageBubble/bubbles/TextBubble.tsx`
- `apps/web/src/features/conversations/components/MessageBubble/bubbles/MediaBubble.tsx`
- `apps/web/src/features/conversations/components/MessageBubble/bubbles/TemplateBubble.tsx`
- `apps/web/src/features/conversations/components/MessageBubble/bubbles/InteractiveBubble.tsx`
- `apps/web/src/features/conversations/components/MessageBubble/bubbles/ReadOnlyBubble.tsx`
- `apps/web/src/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/src/styles/globals.css`
- `apps/web/src/features/conversations/components/ContactPanel.tsx` (apenas hook de toggle/colapso)

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/src/features/conversations/hooks/**`
- `apps/web/src/features/conversations/queries.ts`

## Contratos de entrada

- Design System (doc 18): tokens de cor/espaço/profundidade, light-first com dark, hovers.
- Componentes existentes (não reescrever do zero — ajustar layout/estilo).

## Contratos de saída

- Em qualquer dimensão de tela: texto do bubble legível (sem quebra palavra-a-palavra), composer
  não espremido, e scrollbar discreta em todo o sistema.

## Definition of Done

- [ ] Bubble não quebra palavra-a-palavra ao redimensionar; largura máx. robusta
- [ ] ContactPanel colapsa abaixo do breakpoint com toggle; coluna da conversa tem mínimo legível
- [ ] Composer responsivo (min-width:0, sem espremer ícones/texto)
- [ ] Scrollbar custom sutil (webkit + firefox) em `globals.css`, light/dark, tokens do DS
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` verdes
- [ ] UI usa tokens canônicos do DS (doc 18) — sem hex/spacings hardcoded
- [ ] Verificação visual em 3 larguras (estreita ~768px, média ~1024px, larga ~1440px) descrita no PR
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- A causa-raiz é o **layout**, não a classe de quebra. Comece pelo `ConversationsLayout` (colapso
  do ContactPanel + mínimo do `<main>`); só então afine a `max-w` do bubble.
- Scrollbar: mantenha **discreta** (o usuário reclamou que a nativa se destaca). Thumb fino
  (~8px), cor de borda/surface, sem setas, hover levemente mais visível.
- Não use `word-break: break-all` em texto de mensagem (quebra no meio da palavra — é o que ficou feio).
- Teste visual real importa aqui — descreva no PR o comportamento nas 3 larguras.

```

```
