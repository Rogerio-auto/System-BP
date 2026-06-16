---
id: F16-S12
title: API conversas (read) — list, get, messages (cursor), window state
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#7-ui-conversationspage
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:48:28Z
completed_at: 2026-06-16T06:07:39Z
pr_url: #271
depends_on: [F16-S03, F16-S07]
blocks: [F16-S13, F16-S15]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---

# F16-S12 — API de conversas (leitura)

## Objetivo

Expor os endpoints de leitura do inbox: listar conversas (com filtros + escopo de cidade), obter uma
conversa, paginar mensagens por cursor e consultar o estado da janela (composer). Base da vitrine read-only.

## Contexto

Consome o domínio S07. É o que a vitrine somente-leitura (decisão D4) precisa, junto com realtime (S14).

## Escopo (faz)

- `modules/conversations/routes.ts`: `GET /api/conversations` (filtros status/assigned/channel/search +
  paginação + escopo de cidade + RBAC), `GET /api/conversations/:id`, `GET /api/conversations/:id/messages`
  (cursor desc), `GET /api/conversations/:id/window` (composer state via `getComposerState`).
- `modules/conversations/schemas.ts`: Zod de query/response (DTOs de S03, sem segredos).
- `modules/conversations/service.ts`: orquestra chamadas ao `livechatService` (S07) + monta resposta.

## Fora de escopo (NÃO faz)

- Envio (S13 — adiciona `POST /messages` neste mesmo módulo, sequencial).
- Notas internas / routing / contact panel (slots futuros).
- Socket (S14).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/conversations/routes.ts`
- `apps/api/src/modules/conversations/schemas.ts`
- `apps/api/src/modules/conversations/service.ts`
- `apps/api/src/modules/conversations/__tests__/read.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/livechat/**` (S07 é dono — chamar, não editar)
- `apps/api/src/modules/channels/**`

## Contratos de saída

- `GET /api/conversations`, `/:id`, `/:id/messages`, `/:id/window` — consumidos pelo front (S15).

## Definition of Done

- [ ] List aplica filtros + paginação + `organization_id` + escopo de cidade (teste positivo + negativo)
- [ ] Messages paginadas por cursor (ordem estável)
- [ ] Window state correto por provider
- [ ] Respostas validadas por Zod (request + response), sem campos de segredo
- [ ] **LGPD:** retorna PII (conteúdo/telefone) só para usuário autorizado no escopo; label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- conversations
```

## Notas para o agente

- Front deve ler estes schemas Zod reais (evitar o drift de contrato conhecido do projeto).
- `search` por nome/telefone: telefone é cifrado — buscar por hash/parcial conforme padrão LGPD, não por LIKE em texto plano.
