---
id: F16-S19
title: Composer — seletor de template (janela 24h expirada)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T18:21:26Z
completed_at: 2026-06-16T18:35:46Z
pr_url: null
depends_on: [F16-S13, F16-S17]
blocks: []
labels: []
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/18-design-system.md
docs_required: false
docs_audience: []
docs_artifacts: []
---
# F16-S19 — Composer: seletor de template

## Objetivo

Quando a janela de 24h expira (WhatsApp), o atendente não pode mais enviar texto livre — precisa
usar um template pré-aprovado na Meta. Este slot implementa a UI para selecionar e enviar o
template diretamente do composer.

## Contexto

O `WindowNotice.tsx` (S17) já exibe o aviso de janela expirada. O backend já suporta envio de
template via `POST /api/conversations/:id/messages` com `{ type: 'template', templateName, languageCode, components }`.

A tabela `whatsapp_templates` (migration 0034) contém os templates com `status='approved'`.
Não existe endpoint de listagem de templates para o livechat — precisa ser criado.

## Escopo (faz)

### Backend (1 rota nova)

- `GET /api/conversations/:id/templates` — lista templates `status='approved'` da org da conversa
  - RBAC: `livechat:message:send`
  - Response: `{ data: [{ id, name, category, variables: string[], body_text }] }`
  - Busca em `whatsapp_templates` filtrando por `organization_id` da conversa + `status='approved'`
  - Registrar em `apps/api/src/modules/conversations/routes.ts` (GET)

### Frontend

- Botão "Usar template" no `WindowNotice.tsx` (visível quando `windowState === 'template_only'`)
- Drawer/panel lateral com:
  - Lista de templates aprovados (query `GET /api/conversations/:id/templates`)
  - Preview do body_text de cada template
  - Se `variables.length > 0`: campos de preenchimento por variável (`{{1}}`, `{{2}}` etc.)
  - Botão "Enviar template" → chama a mutation de send existente com `type: 'template'`
- Hook `useConversationTemplates(conversationId)` usando TanStack Query

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/conversations/components/MessageComposer/WindowNotice.tsx`
- `apps/web/src/features/conversations/components/MessageComposer/TemplateSelector.tsx` (novo)
- `apps/web/src/features/conversations/hooks/useConversationTemplates.ts` (novo)
- `apps/api/src/modules/conversations/routes.ts` (adicionar 1 rota GET)
- `apps/api/src/modules/conversations/service.ts` (adicionar 1 função de query)

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/migrations/**` (sem migration necessária)
- `apps/web/src/features/conversations/queries.ts`

## Definition of Done

- [ ] Janela expirada → botão "Usar template" visível no WindowNotice
- [ ] Clicar → drawer abre com lista de templates aprovados
- [ ] Template com variáveis → campos de preenchimento aparecem
- [ ] Enviar template → bolha aparece no chat com status `pending` → `sent`
- [ ] Lista vazia → mensagem "Nenhum template aprovado" com link para Configurações → Templates
- [ ] `pnpm typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/api typecheck
```
