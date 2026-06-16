---
id: F16-S20
title: Composer — emoji picker
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md
status: in-progress
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T18:21:45Z
completed_at: null
pr_url: null
depends_on: [F16-S17]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S20 — Composer: emoji picker

## Objetivo

Substituir o botão "Emoji (em breve)" do MessageComposer por um picker funcional.
Emoji é texto Unicode puro — não requer nenhuma mudança no backend.

## Contexto

O MessageComposer (S17) tem um botão com `aria-label="Inserir emoji (em breve)"` e
`title="Emoji (em breve)"` que não faz nada. Este slot o ativa.

**Sem nova dependência pesada.** Não usar `emoji-mart` (287 kB gzipped). Implementar
um popover leve com os ~200 emojis mais usados em atendimento (rostos, gestos, símbolos comuns)
organizados em categorias simples (Rostos, Gestos, Símbolos, Objetos).

## Escopo (faz)

- `EmojiPicker.tsx` — popover posicionado acima do botão, fecha em Esc/click-outside
- Grid de emojis (20×10 aprox.) em categorias tabuladas
- Busca por nome (filtro local, sem fetch)
- Ao clicar num emoji: insere na posição do cursor no textarea (usando `selectionStart`/`selectionEnd`)
- Fechar automaticamente após inserção
- Acessível: navegação por teclado (arrow keys no grid, Enter para selecionar)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/MessageComposer/EmojiPicker.tsx` (novo)
- `apps/web/src/features/conversations/components/MessageComposer/MessageComposer.tsx`
- `apps/web/src/features/conversations/components/MessageComposer/emoji-data.ts` (novo — lista estática)

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/src/features/conversations/queries.ts`
- `package.json` (sem nova dependência)

## Definition of Done

- [ ] Clicar no botão de emoji → popover abre com grid de emojis
- [ ] Clicar num emoji → inserido na posição do cursor no textarea
- [ ] Esc ou click fora → fecha o popover
- [ ] Busca por "coração" → filtra emojis relevantes
- [ ] Navegação por teclado funcional no grid
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```
