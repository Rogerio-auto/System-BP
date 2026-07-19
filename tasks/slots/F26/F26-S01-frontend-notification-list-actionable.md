---
id: F26-S01
title: Frontend — lista do sino acionável (navegar + ação + ler ao abrir)
phase: F26
task_ref: docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md
status: review
priority: high
estimated_size: M
agent_id: null
depends_on: []
blocks: []
labels: [frontend, notifications, ux, design-system]
source_docs:
  [
    docs/23-notificacoes.md,
    docs/18-design-system.md,
    docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md,
  ]
docs_required: false
claimed_at: 2026-07-19T17:34:41Z
completed_at: 2026-07-19T17:39:36Z
---

# F26-S01 — Frontend: lista do sino acionável

## Objetivo

Transformar cada item da lista de notificações do sino de "só marca lida" em **acionável**:
clicar no item **navega** para a entidade de origem (deep-link), com **botão de ação** explícito
e leitura marcada **ao abrir** (não no clique cego). Resolve os gaps G1, G2, G3, G5 da análise
(doc 23 §14).

## Contexto

Análise em `docs/sessions/2026-07-19-notificacoes-arquitetura-e-gaps.md` e doc 23 §13/§14.
A máquina de deep-link **já existe** mas está ligada só no toast efêmero:

- `resolveNotificationHref(entityType, entityId)` (`useNotificationSocket.ts`) mapeia entidade →
  rota. Hoje só o `handleToastOpen` (`NotificationDropdown.tsx`) navega ao clicar no toast.
- `NotificationItem.tsx` no `onClick` só chama `markRead.mutate(id)` — ignora
  `entity_type`/`entity_id` que já chegam em todo payload REST (`packages/shared-schemas`).

O objetivo é reusar o mesmo resolvedor na **lista persistente**, sem duplicar lógica.

## Escopo (faz)

- Extrair `resolveNotificationHref` para um helper reusável (ex.: `navigation.ts`) importado pelo
  toast **e** pelo item de lista — sem duplicar o mapa entidade→rota.
- `NotificationItem.tsx`: clicar no item **navega** (via `useNavigate` + href resolvido) e, ao
  abrir, marca como lida. Se `entity_type`/`entity_id` não resolvem href, cai no comportamento
  atual (marcar lida) e não navega.
- **Botão de ação** por item (ex.: "Abrir") quando há href; e um affordance **explícito** de
  "marcar como lida" separado da navegação (para itens que o usuário não quer abrir).
- **Não** marcar lida por mero clique que não abre nada nem ao abrir o dropdown. Leitura só por:
  (a) navegar/abrir a entidade, ou (b) o botão explícito de marcar lida.
- Expandir o corpo do item (permitir ver o texto completo além do clamp de 2 linhas) — sem quebrar
  o layout do dropdown.

## Fora de escopo (NÃO faz)

- Backend / enriquecimento de texto das notificações (F26-S02).
- Coluna `severity` e estilo por severidade (F26-S03).
- Página "ver todas" / central `/notificacoes` (F26-S04).
- Alterar o mapa de rotas para abrir o registro específico de `conversation`/`contract` (fica
  para F26-S02/S04) — reusar o mapa atual como está.

## Arquivos permitidos

- `apps/web/src/features/notifications/NotificationItem.tsx`
- `apps/web/src/features/notifications/NotificationDropdown.tsx`
- `apps/web/src/features/notifications/useNotificationSocket.ts`
- `apps/web/src/features/notifications/navigation.ts`
- `apps/web/src/features/notifications/hooks.ts`
- `apps/web/src/features/notifications/index.ts`
- `apps/web/src/features/notifications/__tests__/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `packages/shared-schemas/**`
- `apps/web/src/lib/realtime/**`

## Definition of Done

- [ ] Clicar num item com entidade resolvível navega para a entidade e marca lida ao abrir
- [ ] Existe affordance explícito de "marcar como lida" que não depende de navegar
- [ ] Nenhuma notificação é marcada lida por abrir o dropdown ou por clique que não abre nada
- [ ] `resolveNotificationHref` reusado por toast e item de lista (sem duplicação)
- [ ] Corpo do item pode ser lido por completo (expandir); layout do dropdown intacto
- [ ] Tokens do DS respeitados (sem cor hardcoded); acessível por teclado (foco visível)
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Não crie conexão de socket nova** nem toque em `lib/realtime`.
- O par `entity_type`/`entity_id` já vem no payload REST (`NotificationListResponse`). Use-o.
- Pegadinha documentada (doc 23 §13): o fan-out de `chatwoot.handoff_requested` carimba
  `entity_type='lead'` (não `conversation`). Neste slot **não** corrija isso no backend — apenas
  garanta que `lead` resolve para uma rota útil. O ajuste de origem é do F26-S02.
- Marcar-lida-ao-abrir: aceitável marcar lida no momento da navegação (o usuário abriu). Não é
  preciso callback da página de destino neste slot.
