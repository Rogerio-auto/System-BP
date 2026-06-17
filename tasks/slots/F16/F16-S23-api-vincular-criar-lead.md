---
id: F16-S23
title: API vincular/criar lead da conversa (1-clique manual)
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#1-fluxo-de-mensagem-inbound
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-17T18:52:06Z
completed_at: 2026-06-17T19:21:18Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/308
depends_on: [F16-S22]
blocks: [F16-S24]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/05-modulos-funcionais.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience:
  - dev
docs_artifacts: []
---

# F16-S23 — API vincular/criar lead da conversa

## Objetivo

Expor endpoint HTTP para um agente, a partir do painel de contato, vincular a conversa a um
lead existente **ou** criar+vincular um novo lead em 1 clique — o caminho manual para quando
o dedupe automático (F16-S22) não encontrou match ou a flag de auto-lead está desligada.

## Contexto

F16-S22 vincula automaticamente no inbound. Mas há casos sem match (telefone novo, flag off,
canal sem cidade) em que o contato fica só no inbox. O agente precisa de uma ação explícita
para puxar esse contato para o CRM. Este slot entrega o endpoint que o frontend (F16-S24) consome.

## Escopo (faz)

- Rota `PATCH /api/conversations/:id/lead` em `modules/conversations/routes.ts`:
  - Body: `{ leadId?: string }` — se presente, vincula lead existente; se ausente, cria via
    `getOrCreateLead` usando telefone/nome do contato da conversa + `cityId` do canal.
  - Permission `livechat:conversation:manage` (já existe no catálogo RBAC).
  - Reusa `linkConversationLead` (repo do livechat, F16-S22).
  - Emite audit log (`conversation.lead_linked`) e publica `conversation:updated` no socket relay.
  - Response: `{ conversationId, leadId, created: boolean }`.
- Service `linkOrCreateConversationLead` em `modules/conversations/service.ts`.
- Schemas Zod de request/response em `modules/conversations/schemas.ts`.
- Validação: cidade ausente no canal + sem `leadId` no body → 422 com mensagem clara
  (mesma limitação tech-debt de `leads.city_id`).
- Testes: vínculo de lead existente, criação+vínculo, idempotência (já vinculado → 200 no-op),
  RBAC negativo, escopo de cidade, 422 sem cidade.

## Fora de escopo (NÃO faz)

- Qualquer mudança no frontend (F16-S24).
- Mudar a lógica de dedupe automático no inbound (F16-S22).
- Editar `modules/leads/**` (consumir `getOrCreateLead` read-only).
- Novo helper de set de `lead_id` (já criado em F16-S22).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/conversations/routes.ts`
- `apps/api/src/modules/conversations/service.ts`
- `apps/api/src/modules/conversations/schemas.ts`
- `apps/api/src/modules/conversations/__tests__/lead-link.test.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/livechat/**` (F16-S22 é dono; importar `linkConversationLead`)
- `apps/api/src/modules/leads/**` (módulo CRM é dono)
- `apps/web/**` (F16-S24 é dono)
- `apps/api/src/db/schema/**`

## Contratos de entrada

- `linkConversationLead(db, conversationId, organizationId, leadId)` — entregue por F16-S22.
- `getOrCreateLead(...)` do módulo leads.
- Dados do contato na conversa (`contact_remote_id` = telefone, `contact_name`) + `channel.cityId`.

## Contratos de saída

- `PATCH /api/conversations/:id/lead` com schema Zod estável que F16-S24 consome.
- Evento socket `conversation:updated` com `leadId` no payload (sem PII bruta).

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api lint` verde
- [ ] `pnpm --filter @elemento/api test` verde (incluindo testes novos)
- [ ] RBAC positivo + negativo testado; escopo de cidade respeitado
- [ ] Audit log aplicado e testado
- [ ] Evento `conversation:updated` no socket relay testado (sem PII bruta)
- [ ] Checklist LGPD §14.2 (doc 17) na descrição do PR + label `lgpd-impact`
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- O payload do socket relay segue o padrão LGPD do `livechat-inbound.ts`: apenas IDs opacos.
- Idempotência: se a conversa já tem `lead_id` igual ao solicitado, responda 200 sem mutar.
  Se já tem `lead_id` **diferente** e veio `leadId` novo, decida explicitamente (recomendado:
  rejeitar com 409 para não trocar vínculo silenciosamente) e documente no PR.
- `docs_required: false` justificado: endpoint interno consumido pela UI; a doc de usuário
  vive no slot de frontend (F16-S24).

```

```
