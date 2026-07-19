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
> planejado). Revisado em **2026-07-19** contra o código-fonte após o fechamento da Fase F24
> (21/21 slots). A seção 12 registra o estado atual e o débito remanescente; a seção 13 documenta
> o modelo de dado da notificação e a base de deep-link; a seção 14 mapeia as lacunas de UX do
> sino no frontend — leia-as antes de habilitar qualquer flag ou planejar melhorias.

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

**Inatividade (`kind: 'stage_inactivity'`)** — 7 chaves declaradas no catálogo. Desde F24-S16
**as 7 têm fonte de dados no worker** (`sla-sources.ts`); ver §12.3 para o detalhe de contexto
de template (o worker injeta um contexto mínimo, não os placeholders ricos do catálogo):

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
workers periódicos. Tick default de 1h (reusa `FOLLOWUP_SCHEDULER_TICK_MS`, sem env var própria).
A cada tick:

1. `requireFlag(db, 'notifications.sla.enabled')` — se off, dorme e tenta de novo no próximo
   tick (não sai do loop).
2. Busca `notification_rules` com `trigger_kind='stage_inactivity'` e `enabled=true` — sem
   filtro por organização (varre todas as orgs num único tick).
3. Para cada regra: `findSlaSources(db, orgId, thresholdHours, rule.triggerKey)` roteia pelo
   `trigger_key` para a query da entidade elegível — os 7 eixos do catálogo estão implementados
   (`sla-sources.ts`): `kanban_stage:*|<stageId>`, `handoff:requested`, `simulation:sent_no_reply`,
   `analysis:pendente`, `contract:draft_unsigned`, `payment_due:overdue`, `conversation:no_reply`.
   Para cada entidade: checa delivery existente no bucket da janela atual → filtro de `city_scope`
   → resolve destinatários → renderiza com contexto **mínimo** (`entity_id`, `entity_type`,
   `city_id` — **não** os placeholders ricos que o catálogo anuncia, ver §12.3) → despacha por
   canal → grava delivery. A linha de `notifications` recebe `entity_type`/`entity_id` reais da
   fonte (ex.: `conversation:no_reply` → `conversations.id`), o que habilita deep-link mesmo com
   o texto mínimo (§13).

Erros de uma regra ou entidade são isolados (`try/catch` silencioso) — não derrubam o tick.

## 5. Canais de entrega

### 5.1 In-app (`senders/inApp.ts`)

Persiste uma linha em `notifications` (tabela de F15) — é o dado que alimenta
`GET /api/notifications` e o badge de não-lidas. Após persistir, dispara **fire-and-forget** o
push de tempo real (`publishNotificationSocket`, §5.3) — a falha do socket nunca derruba a
persistência.

### 5.2 Email via Resend (F24-S03 — `senders/email.ts` + `email/resendClient.ts` +

`email/template.ts`)

Substitui o stub de F15. Resolve `users.email` pelo `userId`, monta HTML org-aware
(`resolveOrgBrand` — nome/cor por organização, white-label-ready) e envia via Resend com retry
exponencial (3x). Falha de envio é logada (sem PII) e **nunca propaga** — o fan-out isola falha
de canal. Env vars: `NOTIFICATIONS_EMAIL_ENABLED`, `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO` (validadas por `refine()` em `config/env.ts` — `NOTIFICATIONS_EMAIL_ENABLED=true`
exige `RESEND_API_KEY` e `EMAIL_FROM` presentes, senão o boot falha).

**Gate em duas camadas (F24-S18)**: o envio de email exige que **as duas** estejam ligadas — a
env var `NOTIFICATIONS_EMAIL_ENABLED` (infraestrutura/credenciais, checada primeiro, sem I/O) **e**
a feature flag de banco `notifications.email.enabled` (decisão operacional por organização,
consultada via `requireFlag`). Qualquer uma desligada resulta em no-op limpo (log + return, sem
lançar). Se a consulta da flag falhar (ex.: banco indisponível), o envio é **fail-closed** — não
envia — porque email é o único canal de notificação que sai da rede.

### 5.3 Tempo real — IMPLEMENTADO (F24-S08/S13)

`apps/api/src/modules/notifications/realtime.ts` → `publishNotificationSocket` publica o evento
`notification.new` na sala `user:{userId}` da fila `hm.q.socket.relay` (reusa o relay de socket
do live chat), gateado pela flag `notifications.realtime.enabled` (no-op quando off). É chamado
fire-and-forget pelo `senders/inApp.ts` logo após persistir a linha.

Payload do socket (`NotificationSocketData`): `{ id, type, title, severity, entityType, entityId,
createdAt }` — **sem `body`** (omitido por LGPD; o `body` só existe na linha do banco lida via
REST). O frontend (`useNotificationSocket.ts`) escuta o evento, incrementa o badge de forma
otimista, invalida a query da lista e empilha um **toast** (auto-dismiss por severidade). Sem a
flag ligada, o sino cai no modo **poll** (`GET /api/notifications`) — funcional, sem push
instantâneo. Ver §14 para a assimetria de UX entre o toast (navega) e a lista persistente (não
navega).

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

| Flag                             | Camada que checa                                                                     | Status real                    |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| `notifications.rules.enabled`    | Rotas `notification-rules` (`featureGate`) + fan-out (`requireFlag`, mestre)         | Funcional                      |
| `notifications.sla.enabled`      | Loop do worker `notification-sla-scan` (`requireFlag`)                               | Funcional                      |
| `notifications.email.enabled`    | `senders/email.ts` (`requireFlag`), em série com a env `NOTIFICATIONS_EMAIL_ENABLED` | Funcional (F24-S18)            |
| `notifications.realtime.enabled` | `realtime.ts` (`publishNotificationSocket`) — push `notification.new` sala `user:{}` | Funcional (F24-S08/S13) — §5.3 |

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

## 12. Estado atual e débito remanescente

**Leia esta seção antes de habilitar qualquer flag em produção.** A Fase F24 foi **concluída
integralmente (21/21 slots)**; a maioria das divergências registradas na versão anterior deste
doc (2026-07-10) foi resolvida. O que resta hoje é majoritariamente **débito de UX no frontend**
(§14), não bug de disparo. Cada ponto abaixo foi reconfirmado lendo o código em 2026-07-19.

### 12.1 `notifications.email.enabled` — resolvido (F24-S18)

`senders/email.ts` consulta `requireFlag(db, 'notifications.email.enabled', logger)` **em série**
com a env var `NOTIFICATIONS_EMAIL_ENABLED`. Semântica de duas camadas: env =
infraestrutura/credenciais do deploy (checada primeiro, sem I/O); flag de banco = decisão
operacional por organização. As duas precisam estar ligadas para o email sair. Falha na consulta
da flag (ex.: banco indisponível) é **fail-closed** — não envia, só loga o motivo.

### 12.2 Tempo real (`notifications.realtime.enabled`) — resolvido (F24-S08/S13)

O push em tempo real **existe** e está descrito na §5.3: `realtime.ts` publica `notification.new`
na sala `user:{userId}` (fila `hm.q.socket.relay`), o frontend escuta via `useNotificationSocket.ts`
e mostra toast + badge otimista. A flag gateia o `publishNotificationSocket` (no-op quando off).
Débito remanescente aqui é de **UX**, não de existência: a assimetria de deep-link entre o toast e
a lista persistente do sino (§14).

### 12.3 Worker de estagnação — 7 eixos com fonte, mas contexto de template mínimo

**Resolvido em parte.** `findSlaSources()` (`sla-sources.ts`) roteia corretamente pelo
`trigger_key` para os **7 eixos** do catálogo — `findStagnantKanbanCards`,
`findStalledHandoffRequests`, `findStalledSimulations`, `findStalledAnalyses`,
`findStalledDraftContracts`, `findOverduePaymentDues`, `findStalledConversations`. O gap
"só 1 dos 7" da versão anterior **não existe mais**.

**Débito remanescente (real, confirmado):** o worker (`notification-sla-scan.ts`) monta o
contexto de renderização de template apenas com `{ entity_id, entity_type, city_id }`. Mas o
`TRIGGER_CATALOG` anuncia placeholders ricos por eixo — ex.: `lead_id`,
`chatwoot_conversation_id`, `hours_stalled`, `stage_name`. Como o `renderTemplate` deixa chaves
desconhecidas **literais** (`{{key}}`), qualquer template de SLA que use esses placeholders
renderiza o token cru no texto da notificação. Consequência prática: **é possível cadastrar um
template de SLA "válido" (placeholders existem no catálogo) que produz texto quebrado**. A
entidade em si é referenciada corretamente na linha (`entity_type`/`entity_id` reais da fonte),
então o deep-link funciona; só o **texto** não enriquece. Correção pertence ao backlog (§14,
item de enriquecimento de contexto).

### 12.4 Bug de formato de chave `kanban_stage:*` — corrigido (F24-S16)

O bug histórico (o worker comparava o `trigger_key` literal `'kanban_stage:*'` contra
`kanbanStages.name`) foi corrigido. `sla-sources.ts` hoje faz o strip do prefixo e compara o
`stage_id` (uuid), com `*` → `null` ("qualquer stage"):

```ts
const KANBAN_STAGE_PREFIX = 'kanban_stage:';
if (triggerKey.startsWith(KANBAN_STAGE_PREFIX)) {
  const stageSelector = triggerKey.slice(KANBAN_STAGE_PREFIX.length);
  const stageId = stageSelector === '*' ? null : stageSelector;
  return findStagnantKanbanCards(db, organizationId, thresholdHours, stageId, entityType);
}
```

`findStagnantKanbanCards` filtra `eq(kanbanCards.stageId, stageId)`. Regras criadas pela API real
disparam.

### 12.5 QA de integração fim-a-fim (F24-S14)

Cada slot backend (S01, S05, S06, S07, S09) trouxe testes do próprio módulo. Confirmar o estado
do slot dedicado de cobertura fim-a-fim (engine + SLA + dedup + preferências + RBAC + email mock)
no board antes de tratar a suíte como completa — não assumir que testes por módulo cobrem a
integração `POST /api/notification-rules` → worker.

## 13. Modelo de dado da notificação e deep-link

A linha persistida em `notifications` (schema de F15, `db/schema/notifications.ts`) carrega:

| Coluna            | Tipo              | Papel                                                                                                                              |
| ----------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | uuid PK           | —                                                                                                                                  |
| `organization_id` | uuid NOT NULL     | raiz multi-tenant                                                                                                                  |
| `user_id`         | uuid NOT NULL     | destinatário (FK users, ON DELETE CASCADE)                                                                                         |
| `type`            | text NOT NULL     | string livre — `<canal>:<evento>:<rule_id>`, `sla:<key>:<rule_id>`, ou literal ad-hoc (`livechat.handoff`, `assistant.escalation`) |
| `title`           | text NOT NULL     | título renderizado                                                                                                                 |
| `body`            | text NOT NULL     | corpo renderizado (texto puro — o frontend **não** parseia markdown)                                                               |
| `entity_type`     | text **nullable** | tipo da entidade de origem (`conversation`, `lead`, `credit_analysis`, …) — **base do deep-link**                                  |
| `entity_id`       | uuid **nullable** | id da entidade de origem                                                                                                           |
| `read_at`         | timestamptz null  | marca de leitura                                                                                                                   |
| `created_at`      | timestamptz       | —                                                                                                                                  |

**Não existem** colunas `data`/`metadata` (jsonb), `link`/`url`, `severity` ou `category` na
linha. `severity` é transiente (só no payload do socket). `category` vive na regra/preferência,
não na linha. O escopo de tenant é `organization_id` + `user_id` (a notificação já é pessoal).

**Deep-link:** o par `entity_type` + `entity_id` é a referência máquina-legível da origem,
persistida por `createNotification` e propagada por **todos** os produtores (fan-out, SLA,
handoff ad-hoc, escalação ad-hoc) e ecoada no payload do socket. **Não há URL armazenada** — o
frontend mapeia `entity_type` → rota (`resolveNotificationHref`). Pegadinha a documentar: o
fan-out de `chatwoot.handoff_requested` carimba `entity_type = 'lead'` / `entity_id = leadId`
(via `aggregateType`/`aggregateId` do outbox), **não** a conversa — mesmo o catálogo rotulando o
gatilho como `entityType: 'conversation'`. Quem for construir deep-link precisa considerar esse
descasamento.

## 14. Experiência no frontend (sino) e lacunas de UX

O sino vive no `Topbar` (`NotificationDropdown.tsx`); a lista mostra até 10 itens, badge de
não-lidas, "Marcar todas como lidas", e um **toast** para eventos em tempo real. O estado atual
tem lacunas que reduzem a utilidade operacional — documentadas aqui como fonte para o backlog:

1. **Clique na lista só marca como lida.** `NotificationItem` chama apenas
   `markRead.mutate(id)` no `onClick` — **sem navegação, sem expandir, sem botão de ação**. Não
   há como, a partir de um item do sino, abrir a conversa/lead/card de origem.
2. **Deep-link só no toast efêmero.** `resolveNotificationHref(entityType, entityId)` mapeia
   entidade → rota (`customer` → `/crm/:id`, `credit_analysis` → `/credit-analyses/:id`,
   `conversation` → `/conversas`, `kanban_card` → `/crm?view=kanban`, etc.), mas **só o clique
   no toast** navega (`handleToastOpen`). Depois que o toast some (5–10s) ou a página recarrega, o
   mesmo item na lista persistente **não navega**. `entity_type`/`entity_id` chegam em todo
   payload REST e são **ignorados** pela lista.
3. **Marca-lida imediato no clique** — não há a opção de "abrir sem marcar" nem "marcar como lida
   por ação explícita"; a leitura é efeito colateral obrigatório do único clique disponível.
4. **Textos genéricos.** Os produtores ad-hoc têm corpo pobre em contexto:
   - Handoff (`ai-handoff.ts`): _"Uma conversa no WhatsApp (\<cidade\>) precisa de atendimento
     humano."_ — só o município; sem id da conversa, nome do lead ou resumo.
   - Escalação (`assistant-escalation`): _"Um operador encaminhou um lead para análise de
     crédito. Abra o lead para mais detalhes."_ (+ nota opcional do operador).
     O deep-link resolveria "abrir o quê", mas o texto em si não diz "qual".
5. **Sem severidade/ícone/categoria no item da lista** — o schema REST da notificação nem carrega
   `severity` (só o socket/toast tem). Todos os itens da lista têm o mesmo peso visual.
6. **Sem página "ver todas"** — o rodapé é texto estático ("Mostrando 10 de N"); não há rota de
   central de notificações nem paginação. Notificação além das 10 mais recentes é inacessível na
   UI.
7. **Timestamp só até granularidade de dias**, sem tooltip de data absoluta.

Rotas mapeadas por `resolveNotificationHref` que hoje caem em **lista** e não no registro
específico: `conversation` → `/conversas`, `contract` → `/contratos`. Enriquecer o deep-link para
o registro exato (ex.: abrir a conversa específica) é parte do backlog.

## 15. Ver também

- Ordem de flip das flags + checklist de go-live: [`docs/19-runbook-go-live.md`](19-runbook-go-live.md) §14.
- Catálogo de flags: [`docs/09-feature-flags.md`](09-feature-flags.md) §3.
- Planejamento original (15 slots, decisões travadas 2026-06-30): [`docs/planejamento-notificacoes.md`](planejamento-notificacoes.md).
