---
id: F29-S02
title: Frontend — deep-link do sino abre a conversa específica (não só o inbox)
phase: F29
task_ref: docs/23-notificacoes.md
status: available
priority: high
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [frontend, notifications, livechat, deep-link]
source_docs: [docs/23-notificacoes.md, docs/18-design-system.md]
docs_required: false
---

# F29-S02 — Deep-link do sino para a conversa específica

## Objetivo

Fazer o botão "Abrir conversa" da notificação levar direto à **conversa certa** dentro do live chat,
em vez de só abrir o inbox `/conversas` com a lista vazia.

## Contexto

Reportado pelo Rogério (2026-07-23): clicar em "Abrir conversa" leva ao live chat genérico, não à
conversa. Investigação encontrou dois problemas somados:

1. `features/notifications/deep-link.ts` — para `entity_type='conversation'` retorna `/conversas` e
   **ignora o `entity_id`** (linha ~31). A notificação de handoff carimba
   `entity_type='conversation'`/`entity_id=conversationId` corretamente; o deep-link é que descarta.
2. `features/conversations/components/ConversationsLayout.tsx` — a conversa aberta vive em estado
   **local** (`useState<string|null>(null)`, linha ~135). Não lê nada da URL, então não há como abrir
   uma conversa específica por link, mesmo que a rota o carregasse.

O padrão de deep-link endereçável já existe no projeto (ex.: `/crm/:id`, `/credit-analyses/:id`). Aqui
a conversa é um painel dentro de um layout de 3 colunas (não é rota própria), então o caminho natural
é um **query param** `?conversation=<id>` na rota `/conversas` já existente.

## Escopo (faz)

- `deep-link.ts`: `case 'conversation'` passa a retornar
  `entityId !== null ? \`/conversas?conversation=${entityId}\` : '/conversas'`. Manter a função pura,
  sem dependências (ela é importada no service worker — não arrastar zod/DOM). Atualizar o comentário
  de cabeçalho de `navigation.ts` que documenta a limitação "cai na lista mais próxima".
- `ConversationsLayout.tsx`: no mount, ler `?conversation=` (via `useSearchParams`) e inicializar
  `selectedId` com ele quando presente. Ao selecionar/fechar uma conversa, refletir na URL
  (`setSearchParams`, sem empurrar histórico redundante) para o link ser compartilhável e o "voltar"
  funcionar. Se o id da URL não existir/for inacessível, degradar para a lista sem quebrar.
- Garantir que o `ChatList` destaque/priorize a conversa vinda por deep-link (scroll/seleção), sem
  exigir que o usuário a encontre na lista.
- Testes: deep-link com `entity_id` gera `/conversas?conversation=<id>`; o layout abre a conversa a
  partir do query param; id inexistente cai na lista; selecionar atualiza a URL.

## Fora de escopo (NÃO faz)

- Qualquer alteração no backend ou no schema de notificações.
- Transformar a conversa em rota própria `/conversas/:id` (mudança maior de roteamento — o query
  param resolve o problema relatado).
- Mudar o `entity_type`/`entity_id` produzido pelo backend (já correto).
- Deep-link de outras entidades além de `conversation`.

## Arquivos permitidos

- `apps/web/src/features/notifications/deep-link.ts`
- `apps/web/src/features/notifications/navigation.ts`
- `apps/web/src/features/notifications/__tests__/**`
- `apps/web/src/features/conversations/components/ConversationsLayout.tsx`
- `apps/web/src/features/conversations/components/__tests__/**`

## Arquivos proibidos

- `apps/web/src/App.tsx`
- `apps/web/src/features/conversations/components/ChatList/**` (a menos de prop mínima já existente)
- `apps/web/src/features/conversations/queries.ts`
- `apps/api/**`
- `packages/**`

## Contratos de entrada

- Notificação com `entity_type='conversation'` / `entity_id=<conversationId>` (backend já produz).

## Contratos de saída

- `resolveNotificationHref('conversation', id)` → `/conversas?conversation=<id>`.
- `/conversas?conversation=<id>` abre a conversa correspondente no layout.

## Definition of Done

- [ ] `deep-link.ts` inclui o `entity_id` no href de `conversation`
- [ ] `ConversationsLayout` abre a conversa a partir de `?conversation=<id>` no mount
- [ ] Selecionar/fechar conversa reflete na URL (link compartilhável, botão voltar coerente)
- [ ] Id inexistente/inacessível degrada para a lista sem erro
- [ ] Comentários de cabeçalho de `navigation.ts` atualizados (limitação removida)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- `deep-link.ts` é importado pelo **service worker** — manter puro (sem zod, sem DOM, sem React).
  Só string in/out.
- `ConversationsLayout` já teve regressões de duplo-mount/realtime — **não** remontar o socket nem
  reescrever a seleção; apenas sincronizar `selectedId` com o query param (ler no mount, escrever no
  select). Adicionar, não reescrever.
- Não empurrar uma entrada nova de histórico a cada re-render; usar `replace` quando fizer sentido
  para não poluir o "voltar".
- Design System é lei: nenhuma mudança visual nova além do comportamento de abertura.
