---
id: F16-S13
title: API envio de mensagem — valida janela 24h, idempotência, signed-url, enfileira outbound
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#3-outbound-flow
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:51:14Z
completed_at: null
pr_url: null
depends_on: [F16-S07, F16-S10, F16-S12]
blocks: [F16-S17]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: [dev]
docs_artifacts: []
---
# F16-S13 — API de envio de mensagem

## Objetivo

Endpoint para o atendente humano enviar mensagem (texto/mídia/template/interactive): valida a janela 24h
por provider, exige idempotência, gera signed-url para upload de mídia outbound e enfileira o job no
worker outbound (S10).

## Contexto

Fecha o ciclo de envio. A API só valida + enfileira (envio real é assíncrono no S10). Adiciona ao módulo
`conversations` criado em S12 (por isso é sequencial a S12).

## Escopo (faz)

- `modules/conversations/routes.ts` (estende): `POST /api/conversations/:id/messages` (text/media/template/
  interactive) — valida `getComposerState` (bloqueia texto livre fora da janela → exige template),
  `Idempotency-Key` obrigatório, RBAC + escopo de cidade; persiste `messages` (status `pending`) e
  publica `outbound.request`.
- `modules/conversations/send.schema.ts`: Zod do payload de envio (discriminado por tipo).
- `POST /api/conversations/:id/uploads/signed-url`: signed-url R2 para mídia outbound.
- Audit log do envio humano (regra nº9).

## Fora de escopo (NÃO faz)

- Envio físico à Meta (S10).
- Leitura (S12).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/conversations/routes.ts`
- `apps/api/src/modules/conversations/send.schema.ts`
- `apps/api/src/modules/conversations/send.service.ts`
- `apps/api/src/modules/conversations/__tests__/send.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/conversations/schemas.ts` (S12 é dono)
- `apps/api/src/workers/**`
- `apps/api/src/modules/livechat/**`

## Contratos de entrada

- `getComposerState` (S07), `publish('outbound.request')` (S01), signed-url R2 (S01).

## Contratos de saída

- `POST /api/conversations/:id/messages`, `/uploads/signed-url` — consumidos pelo composer (S17).

## Definition of Done

- [ ] Texto livre bloqueado fora da janela 24h (WA → exige template; resposta clara com CTA)
- [ ] `Idempotency-Key` evita envio duplicado (mesma key = mesma mensagem)
- [ ] Mensagem persistida `pending` + job `outbound.request` publicado na mesma transação lógica
- [ ] Signed-url R2 para mídia outbound
- [ ] Audit log do envio humano; RBAC + escopo de cidade (teste positivo + negativo)
- [ ] **LGPD:** logs sem conteúdo; label `lgpd-impact`; checklist §14.2
- [ ] `pnpm --filter @elemento/api typecheck` / `lint` / `test` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- conversations
```

## Notas para o agente

- A janela 24h é validada aqui **e** reconfirmada no worker (S10) — defesa em profundidade.
- IA jamais envia template fora de regra; este endpoint é envio **humano** (atendente). Auditar o `user_id`.
