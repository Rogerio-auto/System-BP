# 23 — Notificações (Fase F24)

> Doc canônico do sistema de notificações da equipe interna (in-app + email), dirigido por
> um motor de regras configurável + detecção de estagnação. Substitui o fan-out hard-coded e
> morto herdado de F15.
>
> Planejamento original: [`docs/planejamento-notificacoes.md`](planejamento-notificacoes.md).
> Decisões de produtização white-label (multi-controlador): [`negocio/decisoes-arquiteturais-notificacoes.md`](../negocio/decisoes-arquiteturais-notificacoes.md).
> LGPD normativo: [`docs/17-lgpd-protecao-dados.md`](17-lgpd-protecao-dados.md).
> RBAC normativo: [`docs/10-seguranca-permissoes.md`](10-seguranca-permissoes.md).
>
> **Este documento descreve o comportamento REALMENTE implementado no código** (não apenas o
> planejado). A seção 12 lista explicitamente onde a implementação diverge do planejamento
> original ou está incompleta — leia-a antes de habilitar qualquer flag em produção.

## 1. Por que existe

O módulo F15 entregou a fundação (tabelas `notifications`/`notification_preferences`, sino no
frontend, 3 senders) mas o fan-out (`handleFanoutNotification`) nunca foi registrado nos
handlers do outbox — o sistema não notificava ninguém. A Fase F24 substitui isso por um motor
de regras configurável por organização, com dois tipos de gatilho:

- **Eventos do ciclo de vida** (reativo) — ex.: simulação gerada, handoff solicitado, contrato
  assinado, parcela vencida.
- **Estagnação em estágios** (proativo) — ex.: card parado num stage do Kanban além de um
  limiar de horas.

Destinatários são **apenas equipe interna** (in-app + email). Notificação/mensagem para o
**cliente/lead** continua no `followup_rules` existente (WhatsApp) — fora de escopo aqui.

## 2. Arquitetura

### 2.1 Catálogo fechado de gatilhos — `TRIGGER_CATALOG`

Definido em `packages/shared-schemas/src/notification-rules.ts`, compartilhado entre
frontend e backend. É a **fonte da verdade**: o Admin escolhe de um dropdown fechado
(`GET /api/notification-rules/catalog`); não existe chave livre. Cada entrada declara `key`,
`kind` (`event` | `stage_inactivity`), `category`, `entityType` e `placeholders` permitidos
nos templates (sempre IDs opacos/metadados — nunca CPF, telefone ou nome de cidadão).

**Eventos (`kind: 'event'`)** — 9 chaves, uma por evento do outbox:

| `key`                            | `category` | `entityType`    | Placeholders                                                             |
| -------------------------------- | ---------- | --------------- | ------------------------------------------------------------------------ |
| `simulations.generated`          | credit     | simulation      | simulation_id, lead_id, product_id, amount, term_months, monthly_payment |
| `credit_analysis.status_changed` | credit     | credit_analysis | analysis_id, lead_id, from_status, to_status                             |
| `chatwoot.handoff_requested`     | handoff    | conversation    | lead_id, chatwoot_conversation_id, reason                                |
| `contract.signed`                | system     | contract        | contract_id, customer_id, signed_at                                      |
| `contract.near_end`              | system     | contract        | contract_id, customer_id, installments_remaining                         |
| `payment_due.overdue_15d`        | billing    | payment_due     | customer_id, city_id, task_id, overdue_count                             |
| `billing.collection_sent`        | billing    | billing         | collection_job_id, payment_due_id, template_key, attempt_count           |
| `task.created`                   | system     | task            | task_id, assignee_role, type, city_id, entity_type, entity_id            |
| `customer.law_firm_referred`     | system     | customer        | referral_id, customer_id, law_firm_id, channel, sent_at                  |

**Inatividade (`kind: 'stage_inactivity'`)** — 7 chaves declaradas no catálogo (ver §12.3 para
o estado real de implementação — só 1 das 7 tem fonte de dados no worker):

| `key`                      | `category`        | `entityType`    | `timestampSource`               |
| -------------------------- | ----------------- | --------------- | ------------------------------- |
| `kanban_stage:*`           | lifecycle_stalled | kanban_card     | `kanban_cards.stage_changed_at` |
| `handoff:requested`        | handoff           | conversation    | `chatwoot_handoffs.created_at`  |
| `simulation:sent_no_reply` | lifecycle_stalled | simulation      | `simulations.sent_at`           |
| `analysis:pendente`        | lifecycle_stalled | credit_analysis | `credit_analyses.created_at`    |
| `contract:draft_unsigned`  | lifecycle_stalled | contract        | `contracts.created_at`          |
| `payment_due:overdue`      | billing           | payment_due     | `payment_dues.due_date`         |
| `conversation:no_reply`    | lifecycle_stalled | conversation    | `conversations.last_message_at` |

### 2.2 Motor de regras — `notification_rules`

Tabela org-scoped (migration `0076_notification_rules.sql`, slot F24-S01). Cada linha
configura QUANDO e PARA QUEM disparar. Colunas relevantes:

- `trigger_kind` (`event` | `stage_inactivity`) + `trigger_key` — resolvem para uma entrada do
  `TRIGGER_CATALOG`.
- `category` — sempre **derivada do catálogo no backend** (nunca aceita do cliente).
- `threshold_hours` — obrigatório só para `stage_inactivity` (CHECK constraint no DB).
- `filters` jsonb — hoje só usado para `{ city_scope: [uuid, ...] }` (mapeado pela API para o
  campo `city_scope` fora do jsonb — ver `extractCityScope`/`repository.ts`).
- `recipient_mode` (`by_role_city` | `assignee` | `managers`) + `recipient_roles text[]`.
- `channels text[]` — só `in_app` e `email` (WhatsApp não é canal de regra).
- `severity` (`info` | `warning` | `critical`), `cooldown_hours`, `title_template`/`body_template`.
- `enabled boolean DEFAULT false` — regra nasce sempre desligada.

### 2.3 Dedup / idempotência — `notification_rule_deliveries`

`UNIQUE (rule_id, entity_type, entity_id, bucket)` + `fired_at`. Dois usos do `bucket`:

- **Fan-out por evento** (`apps/api/src/handlers/fanout-notification.ts`, F24-S06):
  `bucket = event_outbox.id` — 1 disparo por (regra, entidade, evento), mesmo em reprocesso.
- **Worker de SLA** (`apps/api/src/workers/notification-sla-scan.ts`, F24-S07):
  `bucket = 'sla:' + ruleId + ':' + windowSlot`, onde `windowSlot` é a hora-época dividida pelo
  `cooldown_hours` da regra (`buildSlaBucket`) — garante 1 disparo por janela de cooldown por
  entidade, mesmo que o worker rode várias vezes dentro da mesma janela.

### 2.4 Resolução de destinatários

`apps/api/src/modules/notification-rules/recipients.ts` — reusado por ambos os workers:

- `by_role_city` — `users` ⋈ `user_roles` ⋈ `roles` filtrado por `roles.key IN recipient_roles`
  e `users.status = 'active'`; se `cityId` não for `null`, filtra também por `user_city_scopes`.
  `cityId = null` (contexto global, ex.: preview) retorna todos os usuários com o role na org.
- `assignee` — resolve `kanban_cards.assignee_user_id` a partir do `leadId` extraído do
  contexto do evento (placeholder `lead_id`). Sem `leadId` ou sem card → lista vazia.
- `managers` — usuários ativos com role `admin` ou `gestor_geral`, deduplicados.

Notificações são **pessoais** (uma linha por destinatário); o escopo de cidade entra na
**resolução**, não via `applyCityScope` na leitura.

## 3. Fan-out por evento (F24-S06)

`handleFanoutNotification` está **registrado** em `setupWorkerHandlers()`
(`apps/api/src/workers/index.ts`) para os 9 eventos de `kind: 'event'` do catálogo — um único
handler builder compartilhado, um `registerHandler()` por evento. Isso fecha o gap conhecido de
F15 (fan-out morto, nunca chamado pelo outbox worker).

Fluxo por evento recebido:

1. `requireFlag(db, 'notifications.rules.enabled')` — early return se off (mestre do sistema).
2. Busca `notification_rules` com `trigger_kind='event'`, `trigger_key=event.eventName`,
   `enabled=true`, da `organization_id` do evento.
3. Para cada regra: filtro de `city_scope` → checagem de idempotência (bucket=event_id) →
   resolve destinatários → para cada destinatário × canal, checa
   `isCategoryChannelEnabled` (preferência do usuário) → renderiza templates com o payload do
   evento (`data` do outbox — só placeholders declarados, sem PII bruta) → despacha por canal
   (falha isolada por canal, não derruba os demais) → grava `notification_rule_deliveries`.

## 4. Worker de estagnação — `notification-sla-scan` (F24-S07)

Loop standalone (`apps/api/src/workers/notification-sla-scan.ts`), registrado no supervisor de
workers periódicos. Tick default de 1h (reusa `FOLLOWUP_SCHEDULER_TICK_MS`, sem env var própria
— ver §12.4). A cada tick:

1. `requireFlag(db, 'notifications.sla.enabled')` — se off, dorme e tenta de novo no próximo
   tick (não sai do loop).
2. Busca `notification_rules` com `trigger_kind='stage_inactivity'` e `enabled=true` — sem
   filtro por organização (varre todas as orgs num único tick).
3. Para cada regra: `findSlaSources(db, orgId, thresholdHours, rule.triggerKey)` retorna as
   entidades elegíveis (ver §12.3 — hoje só cobre inatividade de Kanban stage). Para cada
   entidade: checa delivery existente no bucket da janela atual → filtro de `city_scope` →
   resolve destinatários → renderiza (`entity_id`, `entity_type`, `city_id` — contexto mínimo,
   **não** os placeholders ricos do catálogo de eventos) → despacha por canal → grava delivery.

Erros de uma regra ou entidade são isolados (`try/catch` silencioso) — não derrubam o tick.

## 5. Canais de entrega

### 5.1 In-app (`senders/inApp.ts`)

Persiste uma linha em `notifications` (tabela de F15) — é o dado que alimenta
`GET /api/notifications` e o badge de não-lidas. **Não publica em socket/realtime** hoje — ver
§12.2.

### 5.2 Email via Resend (F24-S03 — `senders/email.ts` + `email/resendClient.ts` +

`email/template.ts`)

Substitui o stub de F15. Resolve `users.email` pelo `userId`, monta HTML org-aware
(`resolveOrgBrand` — nome/cor por organização, white-label-ready) e envia via Resend com retry
exponencial (3x). Falha de envio é logada (sem PII) e **nunca propaga** — o fan-out isola falha
de canal. Env vars: `NOTIFICATIONS_EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO` (validadas por `refine()` em `config/env.ts` — `NOTIFICATIONS_EMAIL_ENABLED=true`
exige `RESEND_API_KEY` e `EMAIL_FROM` presentes, senão o boot falha).

**Importante**: o gate real do envio de email é a env var `NOTIFICATIONS_EMAIL_ENABLED`, **não**
a feature flag de banco `notifications.email.enabled` — ver divergência em §12.1.

### 5.3 Tempo real — NÃO IMPLEMENTADO

O planejamento previa um socket relay (`user:{userId}` room + evento `notification.new`,
reusando o relay do live chat). **Isso ainda não existe no código.** Ver §12.2.

## 6. Preferências do usuário (F24-S09 backend / F24-S12 frontend)

`notification_preferences` (tabela de F15) ganhou coluna `category` nullable
(migration `0076`). Dois índices únicos parciais substituem o `UNIQUE (user_id, channel)`
simples, porque `NULL <> NULL` em SQL impediria o upsert de defaults:

- `uq_notification_preferences_user_channel_null_cat` — `WHERE category IS NULL` (default
  genérico do canal).
- `uq_notification_preferences_user_channel_cat` — `WHERE category IS NOT NULL` (override por
  categoria).

Resolução em `isCategoryChannelEnabled` (`notifications/repository.ts`): override de categoria
específica > default genérico do canal > **opt-out** (habilitado por padrão se nada estiver
configurado). Categorias: `lifecycle_stalled`, `assignment`, `credit`, `billing`, `handoff`,
`system`.

Frontend: matriz categoria × canal em `apps/web/src/features/notifications/preferences/`
(`PreferencesMatrix.tsx`), consumida via `GET`/`PUT /api/notifications/preferences`. O canal
`whatsapp` ainda aparece no schema de preferências (herdado de F15) mas nenhuma regra de F24
usa `whatsapp` como canal — `ruleChannelSchema` só permite `in_app`/`email`.

## 7. API — contratos

### 7.1 Módulo `notification-rules` (Admin) — `apps/api/src/modules/notification-rules/`

Todas as rotas exigem `authenticate()` + `authorize({ permissions: ['notifications:manage'] })`

- `featureGate('notifications.rules.enabled')`.

| Método   | Rota                               | Descrição                                                                          |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`    | `/api/notification-rules/catalog`  | Retorna `TRIGGER_CATALOG` completo (dropdown de criação/edição).                   |
| `GET`    | `/api/notification-rules`          | Lista paginada + filtros (`search`, `enabled`).                                    |
| `POST`   | `/api/notification-rules`          | Cria regra (`enabled: false` por padrão). Suporta `Idempotency-Key`.               |
| `GET`    | `/api/notification-rules/:id`      | Detalhe (campos denormalizados do catálogo).                                       |
| `PATCH`  | `/api/notification-rules/:id`      | Atualização parcial. Re-valida placeholders se `trigger_key` mudar.                |
| `DELETE` | `/api/notification-rules/:id`      | Hard delete + audit.                                                               |
| `POST`   | `/api/notification-rules/:id/test` | Preview: resolve destinatários reais + renderiza templates de exemplo, sem enviar. |

Toda mutação grava `auditLog` na mesma transação (`notification_rule.created` /`.updated` /
`.deleted`). `category` e `trigger_kind` **nunca** vêm do cliente — sempre derivados do
`TRIGGER_CATALOG` no service.

### 7.2 Módulo `notifications` (usuário) — `apps/api/src/modules/notifications/`

Todas as rotas exigem `authenticate()` + `authorize({ permissions: ['notifications:read'] })`.
Sem `featureGate` — leitura/gestão das próprias notificações não depende das flags de F24 (são
as mesmas rotas herdadas de F15).

| Método | Rota                             | Descrição                                                             |
| ------ | -------------------------------- | --------------------------------------------------------------------- |
| `GET`  | `/api/notifications`             | Lista paginada do usuário autenticado + `unread_count`.               |
| `POST` | `/api/notifications/:id/read`    | Marca uma notificação como lida (idempotente).                        |
| `POST` | `/api/notifications/read-all`    | Marca todas como lidas (idempotente).                                 |
| `GET`  | `/api/notifications/preferences` | Matriz de preferências (defaults de canal + overrides por categoria). |
| `PUT`  | `/api/notifications/preferences` | Upsert em batch (até 21 itens: 3 canais × (1 global + 6 categorias)). |

## 8. RBAC

- `notifications:manage` (migration `0077`) — CRUD de regras + catálogo + test-fire.
  Atribuída automaticamente a `admin` e `gestor_geral`.
- `notifications:read` (herdada de migration `0056`, F15) — ler/gerenciar as próprias
  notificações e preferências. Atribuída amplamente aos papéis internos operacionais (ver
  seeds de RBAC em `db/migrations/0056_*`).

## 9. Feature flags

4 flags seedadas em migration `0077` — **todas nascem `disabled`**:

| Flag                             | Camada que checa                                                             | Status real                                  |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `notifications.rules.enabled`    | Rotas `notification-rules` (`featureGate`) + fan-out (`requireFlag`, mestre) | Funcional                                    |
| `notifications.sla.enabled`      | Loop do worker `notification-sla-scan` (`requireFlag`)                       | Funcional                                    |
| `notifications.email.enabled`    | **Nenhuma** — o gate real é a env var `NOTIFICATIONS_EMAIL_ENABLED`          | **Flag morta** — ver §12.1                   |
| `notifications.realtime.enabled` | **Nenhuma** — não há código de realtime a gatear (F24-S08/S13 pendentes)     | **Flag morta / feature inexistente** — §12.2 |

Ver §12 para o detalhe de cada divergência antes de decidir a estratégia de flip.

## 10. LGPD

- Placeholders do `TRIGGER_CATALOG` são só IDs opacos e metadados operacionais — nunca CPF,
  telefone ou nome bruto de cidadão. `title_template`/`body_template` **podem** conter PII
  indireta após renderização (ex.: nome de lead se um template usar um placeholder que resolve
  para nome) — cobertos por `pino.redact` nos loggers do fan-out e do sender de email
  (`REDACT_PATHS` inclui `title`, `body`, `subject`, `email`, `cpf`, `telefone`, `phone`).
- `display_name` nos previews de test-fire é dado de colaborador (Art. 7°, IX LGPD), não PII de
  cidadão — aceitável para visualização interna por quem tem `notifications:manage`.
- Email do destinatário nunca é logado (`recipientEmail`/`email` cobertos por redact em
  `senders/email.ts`).
- Retenção de notificações lidas segue o job de retenção geral já existente (`cron-retention`).
- Multi-controlador (white-label): cada organização é Controlador independente — ver
  `negocio/decisoes-arquiteturais-notificacoes.md` e doc 17.

## 11. Telas

### 11.1 Admin — `/admin/notificacoes` (gate `notifications:manage`)

`apps/web/src/features/admin/notification-rules/` (F24-S10/S11):

- `RuleList.tsx` — lista de regras (nome, `trigger_key`, categoria, canais, severidade,
  enabled).
- `RuleDrawer.tsx` — criar/editar: dropdown do catálogo (`TRIGGER_CATALOG` do frontend, mesma
  fonte do backend), campos contextuais (`threshold_hours` só para `stage_inactivity`),
  filtros de cidade, destinatários, canais, severidade, cooldown, templates com hints de
  placeholder.
- `RuleTestPanel.tsx` — chama `POST /:id/test` (preview sem enviar).

### 11.2 Usuário — preferências

`apps/web/src/features/notifications/preferences/` (F24-S12) — matriz categoria × canal com
toggles, consumida na seção de Conta/Configurações do usuário.

## 12. Divergências conhecidas / débito técnico

**Leia esta seção antes de habilitar qualquer flag em produção.** Ela documenta onde a
implementação real diverge do planejamento (`docs/planejamento-notificacoes.md`) ou está
incompleta em relação aos 15 slots decompostos. Nenhum destes pontos é fictício — cada um foi
confirmado lendo o código-fonte em 2026-07-10.

### 12.1 `notifications.email.enabled` é uma flag morta

A flag de banco `notifications.email.enabled` é seedada (migration `0077`) e aparece na tela
`/admin/feature-flags`, mas **nenhum código do backend a consulta**. O gate real do envio de
email é a env var `NOTIFICATIONS_EMAIL_ENABLED` (`config/env.ts` + `senders/email.ts`).
Consequência prática: ligar a flag `notifications.email.enabled` no admin **não tem efeito
nenhum** — quem decide se o email sai é a env var do deploy. Decisão pendente para o Rogério:
(a) fazer `sendEmail` também checar a flag de banco (dupla trava), ou (b) aposentar a flag de
banco e documentar que o gate de email é só via env var. Enquanto isso não for decidido, o
runbook (§14 do doc 19) trata a env var como a trava real.

### 12.2 Tempo real (`notifications.realtime.enabled`) — feature inexistente

F24-S08 ("push em tempo real — sala `user:{}` + publish `notification.new`") e F24-S13 ("sino
de notificações em tempo real — socket + toast + badge") **ainda estão `available`** no board
(não implementados). Hoje:

- `apps/api/src/plugins/socket.ts` só tem as salas `workspace:{orgId}` e `conversation:{id}`
  (do live chat) — não existe sala `user:{userId}`.
- `senders/inApp.ts` só faz `INSERT` na tabela `notifications` — não publica nenhum evento de
  socket.
- A flag `notifications.email.enabled`... perdão, `notifications.realtime.enabled` é seedada
  mas não é checada em lugar nenhum do código, porque não há nada para gatear ainda.

Ou seja: hoje o sino/central de notificações só atualiza via **poll** do frontend
(`GET /api/notifications`), como já funcionava em F15 — não há push. Isso é esperado (slots
não fechados), mas não pode ser confundido com "flag desligada e pronta pra ligar depois": a
feature não existe.

### 12.3 Worker de estagnação só cobre 1 dos 7 eixos de inatividade do catálogo

`findSlaSources()` (`modules/notification-rules/sla-sources.ts`) delega **incondicionalmente**
para `findStagnantKanbanCards()`, independente do `trigger_key` da regra. Os outros 6 eixos
declarados no `TRIGGER_CATALOG` (`handoff:requested`, `simulation:sent_no_reply`,
`analysis:pendente`, `contract:draft_unsigned`, `payment_due:overdue`, `conversation:no_reply`)
**passam na validação Zod ao criar a regra** (existem no catálogo) mas **nunca são avaliados
pelo worker** — uma regra `stage_inactivity` com um desses `trigger_key` fica cadastrada,
habilitada, e nunca dispara, silenciosamente. Não há erro, não há log de alerta — é um gap
funcional, não uma exceção.

### 12.4 Bug de formato de chave no único eixo implementado (`kanban_stage:*`)

Este é o achado mais sério da revisão. `findStagnantKanbanCards(db, orgId, thresholdHours,
triggerKey)` trata `triggerKey` como o **nome literal de um stage do Kanban** (ex.:
`'Qualificação'`) ou o caractere `'*'` sozinho para "qualquer stage":

```ts
if (triggerKey !== '*') {
  conditions.push(eq(kanbanStages.name, triggerKey));
}
```

Mas a **única** entrada de inatividade de Kanban no `TRIGGER_CATALOG` — a única que o
`superRefine` do schema de criação de regra aceita como `trigger_key` válido para esse eixo — é
a string literal `'kanban_stage:*'` (com o prefixo). O frontend (`RuleDrawer.tsx`) envia esse
valor verbatim. Logo, uma regra criada pelo caminho real (API validada + UI) grava
`trigger_key = 'kanban_stage:*'`, e o worker compara `kanbanStages.name = 'kanban_stage:*'` —
que nunca existe como nome de stage real. **Resultado: a única regra de inatividade que
"funciona" na teoria nunca dispara na prática**, se criada pela API pública.

Os testes de `notification-sla-scan.test.ts` não pegam esse bug porque constroem o objeto de
regra diretamente com `triggerKey: 'Qualificacao'` (nome de stage puro) — um valor que a
validação Zod real (`notificationRuleCreateSchema`) rejeitaria, porque não existe no
`TRIGGER_CATALOG`. Ou seja: o teste unitário valida a função `findStagnantKanbanCards`
isoladamente, mas não cobre a integração real `POST /api/notification-rules` →
`notification-sla-scan`.

**Isso precisa ser corrigido antes de ligar `notifications.sla.enabled` em produção** — ver
checklist em doc 19 §14. Duas correções possíveis (decisão de implementação, não deste slot):
(a) `findSlaSources` extrai o nome do stage de outro lugar (ex.: `filters.stage` na regra, hoje
inexistente no schema) e passa só o nome puro para `findStagnantKanbanCards`; ou (b)
`findStagnantKanbanCards` normaliza o prefixo `kanban_stage:` antes de comparar. Nenhuma das
duas está implementada hoje.

### 12.5 QA de integração (F24-S14) ainda não fechado

Cada slot backend (S01, S05, S06, S07, S09) trouxe testes unitários/integração do próprio
módulo (mocks de DB), mas o slot dedicado a cobertura de integração fim-a-fim do sistema de
notificações (engine + SLA + dedup + preferências + RBAC + email mock) segue `available` no
board. Não tratar os testes existentes por módulo como equivalentes a essa cobertura fim-a-fim.

## 13. Ver também

- Ordem de flip das flags + checklist de go-live: [`docs/19-runbook-go-live.md`](19-runbook-go-live.md) §14.
- Catálogo de flags: [`docs/09-feature-flags.md`](09-feature-flags.md) §3.
- Planejamento original (15 slots, decisões travadas 2026-06-30): [`docs/planejamento-notificacoes.md`](planejamento-notificacoes.md).
