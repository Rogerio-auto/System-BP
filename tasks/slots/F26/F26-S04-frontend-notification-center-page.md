---
id: F26-S04
title: Frontend — central de notificações (/notificacoes) + severidade na lista
phase: F26
task_ref: docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F26-S01, F26-S03]
blocks: []
labels: [frontend, notifications, ux, design-system]
source_docs:
  [
    docs/23-notificacoes.md,
    docs/18-design-system.md,
    docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md,
  ]
docs_required: true
docs_artifacts: [docs/help/guias/notificacoes/central-de-notificacoes.mdx]
claimed_at: 2026-07-19T18:23:32Z
completed_at: null
---

# F26-S04 — Frontend: central de notificações

## Objetivo

Dar uma casa às notificações além das 10 do dropdown: rota `/notificacoes` com paginação, filtro
por categoria/lidas e ações em lote; e mostrar **severidade/categoria** visualmente na lista
(consumindo a coluna do F26-S03). Corrige gaps G6 e G7 (doc 23 §14).

## Contexto

Doc 23 §14: o rodapé do dropdown é texto estático ("Mostrando 10 de N") — não há central nem
paginação; itens além dos 10 mais recentes são inacessíveis na UI. `GET /api/notifications` já é
paginado (`page`, `per_page`, `total`, `unread_count`). Após F26-S03 o REST expõe `severity`.
Após F26-S01 existe o helper de navegação reusável e o item acionável.

## Escopo (faz)

- Rota `/notificacoes` (registrar no roteador real — `App.tsx`, ver nota) com listagem paginada,
  reusando o item acionável do F26-S01.
- Filtros: por categoria (as 6 do DS) e por lidas/não-lidas; ação em lote "marcar selecionadas /
  todas como lidas".
- Estilo por **severidade** (faixa/ícone) e rótulo de **categoria** no item, a partir do campo
  `severity` do REST (F26-S03) e do `type`/categoria.
- Link "ver todas" no rodapé do dropdown apontando para `/notificacoes`.
- Doc de ajuda: `docs/help/guias/notificacoes/central-de-notificacoes.mdx` (mdx válido — atenção à
  sintaxe, ver nota do teste de manifest).

## Fora de escopo (NÃO faz)

- Backend (paginação já existe; severidade vem do F26-S03).
- Preferências (já existe matriz em `preferences/`).

## Arquivos permitidos

- `apps/web/src/features/notifications/**`
- `apps/web/src/pages/NotificationsPage.tsx`
- `apps/web/src/App.tsx`
- `docs/help/guias/notificacoes/central-de-notificacoes.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `packages/shared-schemas/**`

## Definition of Done

- [ ] Rota `/notificacoes` lista com paginação e filtros (categoria + lidas/não-lidas)
- [ ] Ação em lote de marcar como lidas funciona
- [ ] Item mostra severidade (faixa/ícone) e categoria, via campo do REST
- [ ] Rodapé do dropdown tem link "ver todas" → `/notificacoes`
- [ ] Doc `central-de-notificacoes.mdx` criado (mdx válido) e teste de manifest do web verde
- [ ] Tokens do DS respeitados; acessível por teclado
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- Rota nova vai no **`App.tsx`** (roteador real); `app/router.tsx` e `navigation.ts` são órfãos
  (ver memória do projeto).
- Reusar o item acionável e o helper de navegação do F26-S01 — não duplicar.
- MDX novo: evitar sintaxe que quebra o parser (`{#anchor}`, `{{1}}`) — rodar o teste do web antes
  do push (incidente de manifest).
- Cores por severidade vêm dos tokens do DS, não hardcoded.
