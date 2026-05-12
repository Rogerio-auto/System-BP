# 04 — Eventos

## 1. Princípios

1. **Outbox transacional.** Toda emissão de evento ocorre na mesma transação que a mutação do agregado, gravada em `event_outbox`.
2. **Nome no padrão `<dominio>.<acao_em_passado>`** (`leads.created`, `kanban.stage_updated`).
3. **Versionamento** via campo `event_version` (default `1`). Quebra de contrato → `v2`.
4. **Idempotência por handler** garantida por `(event_id, handler_name)` em `event_processing_logs`.
5. **Sem efeitos colaterais síncronos críticos.** O publisher entrega; o handler é responsável por tolerância a falha + retry.
6. **Eventos não substituem chamadas síncronas obrigatórias.** Resposta ao WhatsApp continua síncrona; eventos cobrem propagação e analytics.

## 2. Estrutura padrão de payload

```json
{
  "event_id": "uuid",
  "event_name": "leads.created",
  "event_version": 1,
  "occurred_at": "2026-05-04T12:34:56Z",
  "actor": {
    "kind": "user|ai|system|worker",
    "id": "uuid|null",
    "ip": "string|null"
  },
  "correlation_id": "uuid",
  "aggregate": {
    "type": "lead",
    "id": "uuid"
  },
  "data": {
    /* específico do evento */
  },
  "metadata": {
    /* origem, request_id, prompt_version, etc. */
  }
}
```

## 3. Catálogo

> Para cada evento: produtor, consumidores, payload mínimo, idempotência, falhas comuns, retry.

### Domínio: leads

#### `leads.created`

- **Produtor:** `leads.service.create()`, `leads.service.createFromAi()`, processamento de import.
- **Consumidores:** `kanban` (cria card), `analytics` (incrementa métrica), `chatwoot-sync` (atualiza atributos), `notifications`.
- **Data:** `lead_id`, `phone`, `city_id|null`, `source`, `assigned_agent_id|null`, `created_by_kind`.
- **Idempotência:** `event_id` único; criação de card guard com `unique(lead_id)`.
- **Falhas:** lead sem cidade → handler de roteamento marca pendente.
- **Retry:** padrão (3x backoff exponencial, depois DLQ).

#### `leads.updated`

- Campos alterados em `data.changes` (before/after por campo).
- Consumidores: `audit`, `chatwoot-sync` (se cidade ou agente mudou).

#### `leads.imported`

- Emitido por linha aprovada na importação.
- Data inclui `batch_id`, `row_number`.

#### `leads.merged`

- Quando dedupe consolida dois leads.

### Domínio: cities

#### `cities.identified`

- Produtor: tool `identify_city`.
- Data: `lead_id`, `city_id`, `confidence`, `source_text`.
- Consumidores: `leads` (atualiza `city_id`), `kanban` (atualiza card), `routing` (atribui agente).

### Domínio: kanban

#### `kanban.card_created`

- Auto-emitido após `leads.created`.

#### `kanban.stage_updated`

- Data: `card_id`, `from_stage`, `to_stage`, `from_status`, `to_status`, `reason`.
- Consumidores: `analytics` (tempo por etapa), `audit`, `followup` (re-agenda régua).

#### `kanban.outcome_set`

- Data: `card_id`, `outcome`, `reason`.
- Outcome `concluido|abandonado|recusado` cancela jobs ativos.

### Domínio: simulações

#### `credit.product_created` / `credit.product_updated` / `credit.rule_published`

- Toda alteração de produto/regra emite. Snapshot da regra no payload.
- Consumidor: `audit`.

#### `simulations.generated`

- Data: `simulation_id`, `lead_id`, `product_id`, `rule_version_id`, `amount`, `term_months`, `monthly_payment`, `origin`.
- Consumidores: `kanban` (atualiza `last_simulation_id`), `chatwoot-sync` (atualiza atributos da conversa), `analytics`.

#### `simulations.sent_to_customer`

- Quando IA ou agente envia simulação ao cliente. Data: `channel`, `message_id`.

### Domínio: análise de crédito

#### `credit_analysis.added`

- Data: `analysis_id`, `lead_id`, `version`, `status`, `analyst_user_id`.

#### `credit_analysis.updated`

- Data inclui `before`, `after`, `version_before`, `version_after`. Versão nova em `credit_analysis_versions`.

#### `credit_analysis.imported`

- Por linha de importação aprovada.

#### `credit_analysis.status_changed`

- Promoção a `aprovado`/`recusado`/`pendente`.

### Domínio: Chatwoot / WhatsApp

#### `chatwoot.conversation_created`

- Webhook → upsert `chatwoot_conversations`.

#### `chatwoot.message_received`

- Toda mensagem entrante (cliente).
- Idempotência por `chatwoot_message_id`.

#### `chatwoot.message_sent`

- Mensagem saindo (agente humano ou IA via API).

#### `chatwoot.handoff_requested`

- IA pediu handoff. Data: `lead_id`, `reason`, `summary`, `simulation_id|null`.
- Consumidores: handler que cria nota interna e atribui agente.

#### `chatwoot.agent_assigned`

- Após handoff. Atualiza Kanban se necessário.

#### `chatwoot.status_updated`

- Conversa fechou/reabriu.

#### `whatsapp.message_received`

- Webhook bruto antes de processar Chatwoot.

#### `whatsapp.message_sent`

- Envio confirmado.

### Domínio: IA

#### `ai.decision_logged`

- Data: `conversation_id`, `node_name`, `decision`, `tools_called`, `prompt_version`.
- Consumidor primário: `analytics` + persistência em `ai_decision_logs` (escrito direto, evento é redundante mas útil para tracing).

#### `ai.handoff_requested`

- Sinônimo de `chatwoot.handoff_requested` quando origem é IA. Mantemos o último.

### Domínio: assistente interno

#### `internal_assistant.query_created`

- Toda consulta humana ao assistente.

#### `internal_assistant.tool_called`

- Cada tool com `latency_ms`, `result_summary`.

#### `internal_assistant.action_requested`

- Ação que precisa de confirmação humana (ex.: agendar follow-up).

#### `internal_assistant.action_confirmed`

- Após confirmação.

### Domínio: follow-up (gated por flag `followup.enabled`)

#### `followup.scheduled` / `followup.triggered` / `followup.sent` / `followup.failed` / `followup.cancelled`

- Job lifecycle.
- `customer_replied_after_followup`: dispara cancelamento de jobs futuros da régua.

### Domínio: cobrança (gated por `collection.enabled`)

- `payment.due_created`
- `collection.scheduled`
- `collection.triggered`
- `collection.message_sent`
- `collection.failed`
- `payment.marked_as_paid` / `payment.marked_as_overdue` / `payment.renegotiated`

### Domínio: importação

#### `import.batch_created` / `import.batch_validated` / `import.batch_completed` / `import.batch_failed`

### Domínio: feature flags

#### `feature_flag.changed`

- Audit obrigatório. Data: `key`, `before`, `after`, `actor_user_id`.

### Domínio: auth / users

- `user.created`
- `user.role_assigned`
- `user.city_scope_changed`
- `user.session_revoked`

## 4. Tabela de eventos consolidada

| Evento                       | Produtor            | Principais consumidores          | Idempotência                                       | Retry            |
| ---------------------------- | ------------------- | -------------------------------- | -------------------------------------------------- | ---------------- |
| `leads.created`              | leads.service       | kanban, chatwoot-sync, analytics | event_id + unique(lead_id) em card                 | 3x exp           |
| `leads.imported`             | imports.worker      | kanban, analytics                | event_id                                           | 3x               |
| `cities.identified`          | ai tool             | leads, kanban, routing           | event_id                                           | 3x               |
| `kanban.stage_updated`       | kanban.service      | analytics, followup              | event_id                                           | 3x               |
| `simulations.generated`      | simulations.service | kanban, chatwoot-sync            | event_id + unique(simulation_id)                   | 3x               |
| `credit_analysis.added`      | analyses.service    | audit, kanban                    | event_id                                           | 3x               |
| `chatwoot.message_received`  | chatwoot.webhook    | ai, interactions                 | chatwoot_message_id                                | 5x               |
| `chatwoot.handoff_requested` | ai bridge           | chatwoot-sync, kanban            | event_id + unique(handoff per conversation/window) | 3x               |
| `ai.decision_logged`         | langgraph bridge    | analytics                        | event_id                                           | 1x (best effort) |
| `followup.triggered`         | followup.scheduler  | followup.sender                  | unique(lead_id, rule_id, day_bucket)               | 3x               |
| `feature_flag.changed`       | flags.service       | audit                            | event_id                                           | 3x               |

## 5. Política de DLQ

- Após `attempts >= max_attempts`, evento vai para `status='dlq'`.
- DLQ visível em tela admin com filtro, detalhe e botão "Reprocessar".
- Alerta automático para canal de erros se DLQ > 0.

## 6. Garantias

- **At-least-once delivery.** Handlers devem ser idempotentes.
- **Ordering:** garantido por `aggregate_id` via processamento serial por agregado quando relevante (ex.: `kanban_cards`).
- **Atomicidade outbox-mutação:** garantida pela transação. Se outbox falhar, mutação é desfeita.

## 7. Observabilidade

- Métricas:
  - `events.outbox.pending_count`
  - `events.outbox.lag_seconds` (now - oldest pending)
  - `events.handlers.<name>.latency_ms`
  - `events.handlers.<name>.failure_rate`
- Tracing: `correlation_id` propagado de webhook → outbox → handler → integração externa.
