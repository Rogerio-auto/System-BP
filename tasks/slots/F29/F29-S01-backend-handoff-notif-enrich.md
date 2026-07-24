---
id: F29-S01
title: Backend — enriquecer notificação de handoff (cidade via lead + nome do cliente in-app)
phase: F29
task_ref: docs/23-notificacoes.md
status: done
priority: high
estimated_size: S
agent_id: null
depends_on: []
blocks: []
labels: [backend, livechat, notifications, handoff, lgpd]
source_docs: [docs/23-notificacoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-24T00:58:08Z
completed_at: 2026-07-24T01:29:39Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/449
---

# F29-S01 — Enriquecer a notificação de handoff (cidade + nome in-app)

## Objetivo

Fazer a notificação "Atendimento precisa de humano" informar **de quem** e **de qual cidade** é a
conversa, sem violar a LGPD: nome do cliente **apenas no canal in-app**, cidade resolvida também a
partir do lead quando a conversa não a tiver.

## Contexto

Reportado pelo Rogério (2026-07-23): a notificação de handoff só mostra "Uma conversa no WhatsApp
precisa de atendimento humano" — sem nome e sem cidade. Investigação:

- O corpo **já tenta** incluir a cidade (`ai-handoff.ts:234`, `locationPart`), mas sai vazio porque
  `conversations.cityId` está **null** na hora do handoff — lead novo de WhatsApp em pré-atendimento
  normalmente ainda não tem cidade atribuída. A cidade mora no **lead/kanban** nesse momento.
- O nome do cliente é **PII** (doc 17 §8.5) e foi deliberadamente deixado de fora de todo o pipeline.
  Decisão do Rogério (CTO, 2026-07-23): **incluir o nome APENAS no canal in-app** — equipe interna,
  com RBAC + escopo de cidade, que já tem acesso à conversa. NÃO pode vazar para Web Push nem e-mail.

Ponto-chave de segurança que **habilita** a decisão: a notificação de handoff **nativa**
(`triggerLivechatHandoff` → `dispatchHandoffNotifications`) chama **somente** `sendInApp` — não chama
`sendWebPush` nem `sendEmail`. Logo, colocar o nome no corpo dessa notificação nativa permanece
in-app por construção. **É proibido** propagar essa mudança para o caminho de fan-out por regras
(`handlers/fanout-notification.ts`), que espelha `title` para Web Push (suboperador externo) — esse
arquivo é `files_forbidden` aqui.

## Escopo (faz)

- **Cidade (fallback pelo lead):** em `ai-handoff.ts`, quando `claim.cityId` for `null`, resolver o
  `cityId` a partir do lead vinculado à conversa (via `conversations.leadId` → `kanban_cards`/`leads`
  a cidade efetiva do lead). Preferir a cidade da conversa; cair no lead só quando ausente. Nome do
  município é dado público (não PII) — pode ir em qualquer canal.
- **Nome do cliente (in-app only):** resolver o nome de exibição do contato/lead da conversa e
  incluí-lo no corpo da notificação in-app de handoff. Ex.: `"Maria S. — conversa no WhatsApp
(Porto Velho) precisa de atendimento humano. Motivo: … — aguardando há …"`. Manter o **título**
  como está (`Atendimento precisa de humano`).
- **Contenção LGPD (obrigatório):** o nome só entra no `body` passado a `sendInApp`. Não pode ser
  logado (usar apenas em memória), não pode ir para o payload do socket/relay, nem para audit. Se no
  futuro esta função passar a despachar outro canal, o nome NÃO pode acompanhar — deixar comentário
  de guarda explícito no ponto onde o body é montado.
- **Checklist §14.2 do doc 17** no cabeçalho do diff (finalidade, base legal, minimização, retenção,
  redação de log) — a notificação in-app é persistida em `notifications.body`; garantir que o
  `pino.redact` de notificações não deixe o nome vazar em log e que a retenção de notificações já
  cobre o corpo.
- Testes: cidade resolvida pelo lead quando a conversa não tem `cityId`; nome presente no body
  in-app; nome **ausente** de qualquer log/relay/audit; título inalterado.

## Fora de escopo (NÃO faz)

- Qualquer alteração em `handlers/fanout-notification.ts` ou nos senders de push/e-mail.
- Adicionar nome/PII ao payload do socket, ao Web Push, ao e-mail ou ao audit log.
- Mudar o título da notificação, o schema de `notifications`, ou o contrato `entity_type`/`entity_id`
  (continua `conversation`/`conversationId` — usado pelo deep-link do F29-S02).
- Frontend do sino (F29-S02).

## Arquivos permitidos

- `apps/api/src/modules/livechat/ai-handoff.ts`
- `apps/api/src/modules/livechat/__tests__/ai-handoff.integration.test.ts`

## Arquivos proibidos

- `apps/api/src/handlers/fanout-notification.ts`
- `apps/api/src/modules/notifications/senders/**`
- `apps/api/src/db/**`
- `apps/web/**`
- `packages/**`

## Contratos de entrada

- Conversa com `leadId`, `cityId` (possivelmente null), `assignedUserId`.
- Repositórios/schema existentes de `leads`/`kanban_cards`/`cities`/`conversations`.

## Contratos de saída

- Notificação in-app de handoff com nome (in-app only) + cidade resolvida (conversa → lead).
- `entity_type='conversation'` / `entity_id=conversationId` inalterado.

## Definition of Done

- [ ] Cidade aparece no corpo mesmo quando `conversations.cityId` é null (fallback pelo lead)
- [ ] Nome do cliente aparece no corpo **in-app** da notificação de handoff
- [ ] Nome **não** aparece em log, socket/relay, e-mail, Web Push nem audit (testado)
- [ ] Título permanece `Atendimento precisa de humano`
- [ ] Checklist §14.2 do doc 17 preenchido no cabeçalho do diff
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- O nome do contato é **PII**: só em memória, no `body` do `sendInApp`. Nunca logar, nunca no relay,
  nunca no audit. Já existe precedente do padrão "sem PII" em toda a função — você está abrindo UMA
  exceção controlada e só para o in-app; documente-a no código.
- Resolva o nome de forma barata (um único select), preferindo o nome do contato/lead da conversa.
  Se não houver nome, degrade para o texto atual sem nome (não quebre).
- Reaproveite `resolveCityName` e o padrão de `Promise.all` já existentes; a resolução de cidade pelo
  lead deve preferir a cidade da conversa e só então a do lead.
- Não altere `dispatchHandoffNotifications` de forma a passar o nome para além do `sendInApp`.
