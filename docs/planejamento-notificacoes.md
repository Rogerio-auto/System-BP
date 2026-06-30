# Planejamento — Sistema de Notificações orientado ao ciclo de vida (Fase F24)

> Documento de planejamento canônico. Decompõe a Fase **F24** em 15 slots.
> Decisões de produto travadas com o Rogério em 2026-06-30.
> Decisões arquiteturais de produtização (white-label) em [`negocio/decisoes-arquiteturais-notificacoes.md`](../negocio/decisoes-arquiteturais-notificacoes.md).

---

## 1. Por que (problema)

O módulo F15 entregou a **fundação** de notificação (tabelas `notifications` e `notification_preferences`, sino no frontend, 3 senders, um handler de fan-out), mas o sistema **não notifica ninguém hoje**. Três lacunas:

1. **Fan-out morto.** `handleFanoutNotification` (`apps/api/src/handlers/fanout-notification.ts`) existe mas **não está registrado** em `setupHandlers()`/`setupWorkerHandlers()`. O outbox marca `task.created`/`contract.signed` como processados sem gerar notificação.
2. **Regras hard-coded + email stub.** Só dois eventos são tratados, em código. O sender de email (`senders/email.ts`) apenas loga — não há provider. Não existe detecção de **estagnação** (lead parado num estágio).
3. **Sem configuração.** Não há tela para o Admin criar/ajustar regras nem para o usuário escolher o que/como recebe.

O resultado prático: a operação não é avisada quando uma simulação trava, um handoff não é aceito, um contrato fica sem assinar, ou uma parcela vence. **Esse é o coração do valor operacional** — o sistema precisa empurrar a próxima ação para a pessoa certa, na hora certa.

## 2. Objetivo

Sistema de notificações **in-app + email** para a **equipe interna**, dirigido por:

- **Eventos do ciclo de vida** do cliente (reativo) — "simulação gerada", "análise mudou de status", "handoff solicitado", "contrato assinado", "parcela vencida".
- **Estagnação em estágios** (proativo) — "card parado em Documentação há 48h", "simulação enviada sem resposta há 24h", "contrato em rascunho há 72h".

Com um **motor de regras configurável** (Admin), **preferências por usuário** (categoria × canal), **entrega em tempo real** e **email via Resend**.

### Decisões travadas (2026-06-30)
| Decisão | Escolha |
|---|---|
| Destinatário | **Só equipe interna** (in-app + email). WhatsApp ao **cliente** segue no `followup_rules` existente — fora deste escopo. |
| Motor de regras | **Engine configurável completo** (gatilho, filtro, destinatários, canais, severidade, cooldown, templates). |
| Entrega in-app | **Tempo real** via socket relay (reuso do live chat) + fallback poll 60s. |
| Provedor de email | **Resend** (DX moderna, deliverability, templates por tenant → white-label-ready). |

## 3. Jornada do cliente × eventos de notificação

O lead tem **múltiplos eixos de estado simultâneos** (não há um único "status"). Cada eixo é uma fonte de gatilho:

| Etapa da jornada | Eixo / tabela | Evento (reativo) | Estagnação (proativo) |
|---|---|---|---|
| Primeiro contato | `conversations` / `ai_conversation_states` | — | sem resposta do agente (`last_inbound_at`) / IA inativa (`last_message_at`) |
| Pré-atendimento → Simulação | `kanban_cards.stage_id` | `simulations.generated` | parado no stage (`entered_stage_at`) |
| Simulação enviada | `credit_simulations.sent_at` | — | enviada sem retorno do cliente |
| Pedido de atendente | `chatwoot_handoffs` | `chatwoot.handoff_requested` | handoff em `requested` não aceito |
| Documentação | `kanban_cards` | — | parado em Documentação |
| Análise de crédito | `credit_analyses.status` | `credit_analysis.status_changed` | `pendente` aguardando resposta |
| Aprovação / conversão | `customers` | `contract.signed` (downstream) | — |
| Contrato | `contracts.status` | `contract.signed`, `contract.near_end` | `draft` sem assinatura |
| Cobrança | `payment_dues.status` | `payment_due.overdue_15d`, `billing.*` | parcela `overdue` |
| Encaminhamento jurídico | — | `customer.law_firm_referred` | — |
| Tarefas | — | `task.created` | — |

## 4. Arquitetura

### 4.1 Catálogo de gatilhos (definido em código)
Lista **fechada e validada** (em `@elemento/shared-schemas` + módulo backend). O Admin escolhe de um dropdown; não digita chave livre. Cada gatilho declara: `key`, `kind` (`event`|`stage_inactivity`), `category`, `entityType`, placeholders permitidos no template e (para inatividade) a fonte de timestamp.

- **Eventos:** `simulations.generated`, `credit_analysis.status_changed`, `chatwoot.handoff_requested`, `contract.signed`, `contract.near_end`, `payment_due.overdue_15d`, `billing.collection_sent`, `task.created`, `customer.law_firm_referred`.
- **Inatividade:** `kanban_stage:<stage>`, `handoff:requested`, `simulation:sent_no_reply`, `analysis:pendente`, `contract:draft_unsigned`, `payment_due:overdue`, `conversation:no_reply`.

### 4.2 Motor de regras — `notification_rules` (org-scoped)
| Coluna | Descrição |
|---|---|
| `organization_id` | multi-tenant root (FK `organizations`, NOT NULL) |
| `name` | rótulo legível |
| `trigger_kind` | `event` \| `stage_inactivity` |
| `trigger_key` | chave do catálogo |
| `category` | categoria de preferência (derivável do catálogo; armazenada para query) |
| `threshold_hours` | só para `stage_inactivity` (null em evento) |
| `filters` jsonb | `{ cityIds?, productIds?, statuses? }` |
| `recipient_mode` | `by_role_city` \| `assignee` \| `managers` |
| `recipient_roles` text[] | papéis-alvo (usado em `by_role_city`) |
| `channels` text[] | `in_app`, `email` |
| `severity` | `info` \| `warning` \| `critical` |
| `cooldown_hours` | janela de dedup |
| `title_template` / `body_template` | placeholders sem PII bruta |
| `enabled` | liga/desliga a regra |
| audit | `created_by`, `created_at`, `updated_at` |

### 4.3 Dedup / cooldown — `notification_rule_deliveries`
Idempotência: `(rule_id, entity_type, entity_id, bucket)` + `fired_at`. Garante:
- Evento processado **uma vez** por `(event_id, rule_id, user_id)`.
- Inatividade dispara **uma vez por janela** de `cooldown_hours` por entidade.

Fecha o gap conhecido de idempotência do fan-out atual (que aceita duplicatas em reprocesso do outbox).

### 4.4 Resolução de destinatários (respeitando cidade)
Reusa o padrão de `resolveTaskCreatedRecipients` (`notifications/repository.ts`): join com `user_city_scopes` para `by_role_city`; `assignee` resolve `kanban_cards.assignee_user_id`; `managers` resolve admin/gestor_geral da org. Notificações são pessoais (filtro por `user_id`), não usam `applyCityScope` direto — o escopo de cidade entra na **resolução**.

### 4.5 Preferências — estender `notification_preferences`
Adicionar coluna `category` (nullable). `null` = default do canal; valor = override por categoria. Categorias: `lifecycle_stalled`, `assignment`, `credit`, `billing`, `handoff`, `system`. Resolução: override de categoria > default do canal > opt-out (default habilitado). `isChannelEnabled` evolui para `isCategoryChannelEnabled`.

### 4.6 Email (Resend)
Env: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `NOTIFICATIONS_EMAIL_ENABLED`. `senders/email.ts` real: resolve `users.email`, template HTML **org-aware** (marca/cor por org), retry com backoff, evento de falha em erro. `pino.redact` cobre `email`. Bounce/complaint webhook = follow-up.

### 4.7 Tempo real (reuso do socket relay)
- Join em `user:{userId}` em `setupSocketHandlers` (`plugins/socket.ts`) — hoje só `workspace:{}` e `conversation:{}`.
- Ao criar in-app, publicar job em `hm.q.socket.relay`: `room=user:{userId}`, `event=notification.new`, `data` mínimo (`id,type,title,severity,entityType,entityId,createdAt`).
- Frontend: `useNotificationSocket` → invalida query + badge ao vivo + toast por severidade. Poll 60s permanece como fallback.

### 4.8 RBAC + feature flags
- Permissão **`notifications:manage`** (admin automático + `gestor_geral`). `notifications:read` já cobre sino/preferências.
- Flags (quad-gate, padrão do projeto): `notifications.rules.enabled` (master), `notifications.sla.enabled` (worker inatividade), `notifications.email.enabled` (canal email), `notifications.realtime.enabled` (push). **Todas começam disabled.**

## 5. Telas

### 5.1 Admin — `/admin/notificacoes` (gate `notifications:manage`)
- Lista de regras (nome, gatilho, categoria, canais, severidade, enabled, última execução). Card na `ConfiguracoesPage` → grupo Administração técnica.
- Drawer criar/editar: dropdown do catálogo de gatilhos → campos contextuais (threshold só em inatividade), filtros (cidade/produto), destinatários (modo + papéis), canais, severidade, cooldown, templates com **preview de placeholders**, toggle enabled.
- Botão **Testar (preview)**: chama endpoint test-fire que resolve destinatários e renderiza o template **sem enviar**.

### 5.2 Usuário — aba "Notificações" em `/configuracoes` (Conta)
- Nova `SectionCard` em `ContaSection`: matriz **categoria × canal** (in-app/email) com toggles + **mute global**. Default tudo ligado (opt-out).

## 6. Modelo de regras-default (seed sugerido, todas `enabled=false` até validação)
| Nome | Gatilho | Destinatário | Canais | Severidade |
|---|---|---|---|---|
| Nova simulação gerada | event `simulations.generated` | `assignee` | in_app | info |
| Análise mudou de status | event `credit_analysis.status_changed` | `by_role_city` [agente,gestor_regional] | in_app, email | info |
| Handoff solicitado | event `chatwoot.handoff_requested` | `by_role_city` [agente] | in_app | warning |
| Contrato assinado | event `contract.signed` | `managers` | in_app, email | info |
| Parcela vencida 15d | event `payment_due.overdue_15d` | `by_role_city` [cobranca] | in_app, email | critical |
| Parado em Documentação 48h | inactivity `kanban_stage:Documentação` 48h | `assignee` | in_app | warning |
| Simulação sem retorno 24h | inactivity `simulation:sent_no_reply` 24h | `assignee` | in_app | warning |
| Handoff não aceito 2h | inactivity `handoff:requested` 2h | `by_role_city` [gestor_regional] | in_app, email | critical |
| Contrato em rascunho 72h | inactivity `contract:draft_unsigned` 72h | `managers` | in_app | warning |

## 7. Decomposição em slots (F24)

### Bloco A — Fundação
- **F24-S01** (db) — Tabelas `notification_rules`, `notification_rule_deliveries` + coluna `category` em `notification_preferences`.
- **F24-S02** (db) — Seed: permissão `notifications:manage` + feature flags `notifications.*`.
- **F24-S03** (backend) — Provider Resend + `senders/email.ts` real (org-aware, retry, redact).
- **F24-S04** (backend) — Catálogo de gatilhos + schemas Zod em `shared-schemas`.

### Bloco B — Engine
- **F24-S05** (backend) — Módulo `notification-rules` (CRUD + RBAC + org-scope + test-fire/preview).
- **F24-S09** (backend) — Preferências por categoria (API + `isCategoryChannelEnabled`).
- **F24-S06** (backend) — Fan-out rules-driven + registro no outbox + idempotência + dedup.
- **F24-S07** (backend) — Worker `notification-sla-scan` (estagnação) + supervisor + flag.
- **F24-S08** (backend) — Tempo real: sala `user:{}` + publish `notification.new`.

### Bloco C — Frontend
- **F24-S10** (frontend) — Página Admin lista de regras + card.
- **F24-S11** (frontend) — Drawer criar/editar regra + test-fire UI.
- **F24-S12** (frontend) — Preferências do usuário (matriz categoria × canal).
- **F24-S13** (frontend) — Sino em tempo real (socket + toast + badge ao vivo).

### Bloco D — QA + docs
- **F24-S14** (qa) — Testes de integração (engine, sla, dedup, prefs, RBAC, email mock).
- **F24-S15** (backend/docs) — Doc canônico `docs/22-notificacoes.md` + flags + runbook go-live.

## 8. Go-live (ordem de flip das flags)
1. `notifications.email.enabled` (valida envio Resend com 1 usuário).
2. `notifications.rules.enabled` (liga o fan-out por evento; observa dedup).
3. `notifications.realtime.enabled` (push no sino).
4. `notifications.sla.enabled` (liga o worker de estagnação por último — maior volume).

Antes de qualquer flip: `security-reviewer` (RBAC, org-scope, idempotência, redact de email/PII) + checklist LGPD §14.2 nos slots que tocam destinatário.

## 9. LGPD
- Templates e payloads de socket **sem PII bruta** (usar refs/IDs; nome de lead é PII indireta — permitido no corpo da notificação ao próprio destinatário interno autenticado, nunca em logs).
- Email do usuário é PII → `pino.redact`.
- Retenção: notificações lidas são limpas pelo job de retenção existente (`cron-retention`).
- Multi-controlador (white-label): cada org é Controlador independente — ver `negocio/decisoes-arquiteturais-notificacoes.md` e `docs/17-lgpd-protecao-dados.md`.
