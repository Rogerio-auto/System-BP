---
id: F16-S22
title: Inbound dedupe-and-link contato→lead + flag auto-lead
phase: F16
task_ref: docs/planejamento-live-chat-proprio.md#1-fluxo-de-mensagem-inbound
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S07, F16-S08]
blocks: [F16-S23, F16-S24]
labels: [lgpd-impact]
source_docs:
  - docs/planejamento-live-chat-proprio.md
  - docs/05-modulos-funcionais.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience:
  - gestor
  - dev
docs_artifacts:
  - docs/help/guias/livechat/vinculo-automatico-crm.mdx
---

# F16-S22 — Inbound dedupe-and-link contato→lead + flag auto-lead

## Objetivo

No primeiro inbound do live chat, vincular automaticamente a conversa a um lead do CRM
quando o telefone do contato já existe, e — sob feature flag — criar um lead-shell quando
não existe. Fecha o gap em que `conversations.lead_id` nascia sempre `NULL` e a ponte para
`interactions` (já implementada em `livechat/service.ts:231`) nunca disparava sozinha.

## Contexto

Hoje `ensureContactConversation` grava o contato inline na conversa (`contact_remote_id`,
`contact_name`, `contact_phone_enc`) mas **não** olha o CRM. A lógica de dedupe-por-telefone
**já existe** e é testada: `getOrCreateLead` / `findLeadByPhoneInOrg` (`modules/leads/service.ts:808`,
`modules/leads/repository.ts:361`), construída para o canal IA (F3-S13). Este slot apenas
**liga o pipeline inbound a essa lógica** — não reescreve dedupe.

Regra de produto (decisão Rogério, 2026-06-17):

- **Link de lead existente** = sempre ligado, barato, sem criação. Só faz lookup e seta `lead_id`.
- **Criação de lead-shell** quando não há match = atrás da flag `livechat.auto_lead.enabled`
  (default `off` — política do cliente). Para o Banco do Povo a flag fica `on` em estágio
  inicial não-qualificado.

## Escopo (faz)

- Helper de repo `linkConversationLead(db, conversationId, organizationId, leadId)` em
  `modules/livechat/repo.ts` — set idempotente de `conversations.lead_id` (no-op se já vinculado).
- Em `ensureContactConversation` (ou passo dedicado no worker `livechat-inbound.ts`, logo após
  garantir a conversa), quando a conversa está **sem `lead_id`** e o contato tem telefone:
  1. Normalizar `contactRemoteId` (E.164) e fazer lookup via `findLeadByPhoneInOrg` no escopo da org.
  2. **Match** → `linkConversationLead`. (A bridge de `interactions` passa a disparar nas próximas mensagens.)
  3. **Sem match** → checar `livechat.auto_lead.enabled` via `isFlagEnabled`/`requireFlag`.
     Se ligada **e** o canal tem `cityId` → `getOrCreateLead` (cria lead-shell + card kanban +
     emite `leads.created` no outbox) e `linkConversationLead`. Se desligada ou sem `cityId` →
     deixa `lead_id` NULL (contato fica só no inbox; vínculo manual via F16-S23/S24).
- Semear a flag `livechat.auto_lead.enabled` em `db/seeds/featureFlags.ts` (default `off`).
- O lookup/criação roda na transação correta e **nunca** quebra o pipeline inbound: falha de
  vínculo loga warning e segue (ack normal da mensagem).
- Testes: match→link, no-match+flag-on→create+link, no-match+flag-off→NULL, no-match+flag-on+sem-cityId→NULL,
  idempotência (segundo inbound não re-vincula nem duplica lead).

## Fora de escopo (NÃO faz)

- Endpoint HTTP de vínculo/criação manual (F16-S23).
- Qualquer mudança no frontend (F16-S24).
- Reescrever dedupe ou tocar `modules/leads/**` (consumir `getOrCreateLead`/`findLeadByPhoneInOrg` read-only).
- Tornar `leads.city_id` nullable (tech debt F3-S04 / migration 23+ — fora daqui).
- UI de admin de feature flags (já genérica; a flag nova aparece automaticamente).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/livechat/service.ts`
- `apps/api/src/modules/livechat/repo.ts`
- `apps/api/src/workers/livechat-inbound.ts`
- `apps/api/src/db/seeds/featureFlags.ts`
- `apps/api/src/modules/livechat/__tests__/livechat.test.ts`
- `apps/api/src/workers/__tests__/livechat-inbound.test.ts`
- `docs/help/guias/livechat/vinculo-automatico-crm.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/leads/**` (módulo CRM é dono — consumir via import, não editar)
- `apps/api/src/modules/conversations/**` (F16-S23 é dono)
- `apps/web/**` (F16-S24 é dono)
- `apps/api/src/db/schema/**` (sem mudança de schema — `conversations.lead_id` já existe)

## Contratos de entrada

- `conversations.lead_id uuid NULL` (schema F16) + FK para `leads` ON DELETE SET NULL.
- `getOrCreateLead(db, organizationId, GetOrCreateLeadInput, requestIp)` e
  `findLeadByPhoneInOrg(db, phoneNormalized, organizationId)` exportados pelo módulo leads.
- `normalizePhone` em `modules/leads/schemas.ts`.
- `isFlagEnabled` / `requireFlag` (`lib/featureFlags.ts`).

## Contratos de saída

- Após primeiro inbound de contato conhecido: `conversations.lead_id` preenchido.
- Flag `livechat.auto_lead.enabled` registrada no seed (default off).
- `getOrCreateLead` chamado com `source: 'whatsapp'`, `name: contactName`, `cityId: channel.cityId`.

## Definition of Done

- [ ] Código implementado conforme escopo
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api lint` verde
- [ ] `pnpm --filter @elemento/api test` verde (incluindo os 5 casos novos)
- [ ] Idempotência testada (segundo inbound não duplica lead nem re-vincula)
- [ ] Evento `leads.created` via outbox testado no caminho de criação
- [ ] Flag respeitada (on/off) com teste positivo e negativo
- [ ] LGPD: telefone nunca logado em texto plano; lookup usa normalizado; sem PII bruta no outbox
- [ ] Checklist LGPD §14.2 (doc 17) na descrição do PR + label `lgpd-impact`
- [ ] Documentação criada em `docs/help/guias/livechat/vinculo-automatico-crm.mdx`
- [ ] PR aberto com checklist e link para o slot

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Reuse, não reescreva.** `getOrCreateLead` já valida E.164, normaliza, faz lookup, cria
  lead + card kanban e emite outbox. Sua função é orquestrar a chamada a partir do inbound.
- O caminho de **link** (match) não precisa de `cityId` nem de flag — é sempre seguro e barato.
- O caminho de **criação** exige `channel.cityId` (tech debt: `leads.city_id` é NOT NULL).
  Se o canal não tiver cidade, **não** crie — deixe para o vínculo manual (F16-S24).
- Não deixe o vínculo quebrar o ack da mensagem. Envolva em try/catch com warning (IDs opacos).
- `contactName` pode ser `undefined` — `GetOrCreateLeadInput.name` aceita undefined.
- Default da flag é `off`: o slot **não** liga para o Banco do Povo aqui; isso é decisão de
  rollout (seed/admin), não do código.

```

system The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate to add new tasks and TaskUpdate to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable.


```
