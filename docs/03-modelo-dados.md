# 03 — Modelo de Dados

> PostgreSQL 16+. Convenção `snake_case`, PKs `uuid` com `gen_random_uuid()`, timestamps `timestamptz`. Toda tabela tem `created_at`, `updated_at`. Tabelas mutáveis sensíveis têm `created_by`, `updated_by`. Soft delete via `deleted_at` apenas onde explicitado.

## Convenções globais

- IDs: `uuid` (pgcrypto).
- Texto sensível: `text` + criptografia em camada de aplicação para CPF (pgcrypto opcional).
- Enums: tabelas `*_enum` quando o domínio pode evoluir; `text` com CHECK quando estável.
- Índices: nomeados `idx_<tabela>_<colunas>`. Índices únicos parciais para soft delete.
- FKs: `ON DELETE RESTRICT` por padrão. `ON DELETE CASCADE` apenas em filhas claramente subordinadas.

---

## 1. Identidade e organização

### `organizations` (preparação multi-tenant)

| Coluna     | Tipo               | Notas |
| ---------- | ------------------ | ----- |
| id         | uuid PK            |       |
| name       | text not null      |       |
| slug       | text unique        |       |
| settings   | jsonb default '{}' |       |
| created_at | timestamptz        |       |

> No MVP existe 1 row (Banco do Povo). Toda tabela de domínio carrega `organization_id` desde já.

### `users`

| Coluna                 | Tipo                                         | Notas          |
| ---------------------- | -------------------------------------------- | -------------- |
| id                     | uuid PK                                      |                |
| organization_id        | uuid FK organizations                        |                |
| email                  | citext unique                                |                |
| password_hash          | text                                         | bcrypt cost 12 |
| full_name              | text                                         |                |
| status                 | text CHECK (`active`, `disabled`, `pending`) |                |
| last_login_at          | timestamptz                                  |                |
| totp_secret            | text null                                    | encrypted      |
| created_at, updated_at | timestamptz                                  |                |

Índices: `idx_users_org`, unique `(organization_id, email)`.

### `roles`

- `id`, `key` (`admin`, `gestor_geral`, `gestor_regional`, `agente`, `operador`, `leitura`), `name`, `description`.

### `user_roles`

- `user_id`, `role_id`. PK composta.

### `permissions`

- Catálogo declarativo: `key` (`leads:read`, `leads:write`, `analyses:write`, `flags:manage`...), `description`.

### `role_permissions`

- `role_id`, `permission_id`. PK composta.

### `user_city_scopes`

- `user_id`, `city_id`. PK composta. Controla a quais cidades o usuário tem acesso.
- Vazio + role `gestor_geral|admin` = acesso global.

### `user_sessions`

- `id`, `user_id`, `refresh_token_hash`, `user_agent`, `ip`, `created_at`, `expires_at`, `revoked_at`.

---

## 2. Geografia e times

### `cities`

| Coluna          | Tipo                 |
| --------------- | -------------------- | --------------------- |
| id              | uuid PK              |
| organization_id | uuid FK              |
| name            | text                 |
| slug            | text                 |
| state_uf        | char(2) default 'RO' |
| ibge_code       | text null            |
| aliases         | text[]               | matching de variações |
| is_active       | bool default true    |

Índice GIN em `aliases` (com `unaccent` + `pg_trgm`) para fuzzy match em `identify_city`.

### `agents`

- `id`, `organization_id`, `user_id` (FK users), `display_name`, `phone`, `is_active`.

### `agent_city_assignments`

- `agent_id`, `city_id`, `is_primary`. Para roteamento.

---

## 3. CRM: leads e clientes

### `leads`

| Coluna                 | Tipo                                                                              | Notas                         |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| id                     | uuid PK                                                                           |                               |
| organization_id        | uuid FK                                                                           |                               |
| customer_id            | uuid FK customers null                                                            | criado quando dados completos |
| city_id                | uuid FK cities null                                                               | null = pendente identificação |
| assigned_agent_id      | uuid FK agents null                                                               |                               |
| source                 | text CHECK (`whatsapp`, `manual`, `import_notion`, `import_trello`, `import_csv`) |                               |
| status                 | text CHECK (`active`, `archived`, `merged`)                                       |                               |
| origin_metadata        | jsonb default '{}'                                                                | UTM, campanha, etc.           |
| tags                   | text[] default '{}'                                                               |                               |
| primary_phone          | text not null                                                                     | normalizado E.164             |
| primary_phone_hash     | text generated                                                                    | hash para dedupe              |
| display_name           | text                                                                              |                               |
| notes                  | text                                                                              |                               |
| created_at, updated_at |                                                                                   |                               |
| created_by             | uuid FK users null                                                                | null = criado por IA          |

Índices:

- `unique (organization_id, primary_phone) where status != 'merged'` — evita duplicidade ativa.
- `idx_leads_city_status (city_id, status)`.
- `idx_leads_assigned_agent (assigned_agent_id)`.
- GIN em `tags`.

### `customers`

- Identificação formal. Criado quando se obtém CPF/CNPJ.
- `id`, `organization_id`, `document_type` (`cpf`/`cnpj`), `document_number` (criptografado), `document_hash` (sha256 para busca/dedupe), `full_name`, `birth_date`, `email`, `consent_at`, `lgpd_basis`.
- Unique `(organization_id, document_hash)`.

### `customer_contacts`

- `id`, `customer_id`, `kind` (`phone`/`email`/`whatsapp`), `value`, `is_primary`, `verified_at`.

### `customer_addresses`

- `id`, `customer_id`, `city_id`, `street`, `number`, `complement`, `district`, `cep`.

### `lead_history`

- Timeline append-only. `id`, `lead_id`, `event_type`, `payload jsonb`, `actor_user_id`, `actor_kind` (`user`/`ai`/`system`), `created_at`.

---

## 4. Kanban

### `kanban_stages`

- Catálogo: `key` (`pre_atendimento`, `simulacao`, `documentacao`, `analise_credito`, `concluido`), `position`, `is_active`.

### `kanban_cards`

| Coluna             | Tipo                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| id                 | uuid PK                                                                                      |
| organization_id    | uuid FK                                                                                      |
| lead_id            | uuid FK leads unique                                                                         |
| stage_key          | text FK kanban_stages.key                                                                    |
| status             | text                                                                                         | subestado livre validado por enum por stage |
| outcome            | text CHECK (`pending`, `aprovado`, `recusado`, `abandonado`, `contratado`) default `pending` |
| city_id            | uuid FK cities                                                                               |
| assigned_agent_id  | uuid FK agents null                                                                          |
| product_id         | uuid FK credit_products null                                                                 |
| last_simulation_id | uuid FK credit_simulations null                                                              |
| last_analysis_id   | uuid FK credit_analyses null                                                                 |
| stage_entered_at   | timestamptz                                                                                  | atualizado a cada mudança                   |
| metrics            | jsonb                                                                                        | tempos por etapa cacheados                  |

### `kanban_stage_history`

- `id`, `card_id`, `from_stage`, `to_stage`, `from_status`, `to_status`, `reason`, `actor_user_id`, `actor_kind`, `created_at`.
- Append-only. Base para métricas de tempo por etapa.

---

## 5. Crédito

### `credit_products`

- `id`, `organization_id`, `key` (slug), `name`, `description`, `is_active`, `created_at`.
- Não armazena regras numéricas diretamente; aponta para `credit_product_rules` ativas.

### `credit_product_rules`

| Coluna                           | Tipo                                        |
| -------------------------------- | ------------------------------------------- | ---------------------------------- |
| id                               | uuid PK                                     |
| product_id                       | uuid FK credit_products                     |
| version                          | int                                         |
| min_amount, max_amount           | numeric(14,2)                               |
| min_term_months, max_term_months | int                                         |
| monthly_rate                     | numeric(8,6)                                | taxa mensal decimal (0.025 = 2,5%) |
| iof_rate                         | numeric(8,6) null                           |                                    |
| amortization                     | text CHECK (`price`, `sac`) default `price` |
| city_scope                       | uuid[] null                                 | regras específicas por cidade      |
| effective_from                   | timestamptz                                 |
| effective_to                     | timestamptz null                            |
| is_active                        | bool                                        |
| created_by                       | uuid FK users                               |

Constraint: `unique (product_id, version)`. Apenas uma `is_active=true` por produto/cidade vigente.

### `credit_simulations`

| Coluna                | Tipo                                  |
| --------------------- | ------------------------------------- | ------------------------- |
| id                    | uuid PK                               |
| organization_id       | uuid FK                               |
| lead_id               | uuid FK leads                         |
| customer_id           | uuid FK customers null                |
| product_id            | uuid FK credit_products               |
| rule_version_id       | uuid FK credit_product_rules          | **imutável após criação** |
| amount_requested      | numeric(14,2)                         |
| term_months           | int                                   |
| monthly_payment       | numeric(14,2)                         |
| total_amount          | numeric(14,2)                         |
| total_interest        | numeric(14,2)                         |
| rate_monthly_snapshot | numeric(8,6)                          |
| amortization_table    | jsonb                                 | parcelas                  |
| origin                | text CHECK (`ai`, `manual`, `import`) |
| created_by_user_id    | uuid null                             |
| created_by_ai_log_id  | uuid FK ai_decision_logs null         |
| created_at            | timestamptz                           |

Índices: `idx_sim_lead`, `idx_sim_customer`.

### `credit_analyses`

| Coluna                 | Tipo                                                          |
| ---------------------- | ------------------------------------------------------------- | -------------- |
| id                     | uuid PK                                                       |
| organization_id        | uuid FK                                                       |
| lead_id                | uuid FK leads                                                 |
| customer_id            | uuid FK customers null                                        |
| simulation_id          | uuid FK credit_simulations null                               |
| current_version_id     | uuid FK credit_analysis_versions null                         |
| status                 | text CHECK (`em_analise`, `pendente`, `aprovado`, `recusado`) |
| approved_amount        | numeric(14,2) null                                            |
| approved_term_months   | int null                                                      |
| approved_rate_monthly  | numeric(8,6) null                                             |
| internal_score         | numeric(6,2) null                                             | gated por flag |
| analyst_user_id        | uuid FK users null                                            |
| origin                 | text CHECK (`manual`, `import`)                               |
| created_at, updated_at |                                                               |

### `credit_analysis_versions`

- Versionamento explícito de pareceres.
- `id`, `analysis_id`, `version`, `status`, `parecer_text`, `pendencias jsonb`, `attachments jsonb`, `author_user_id`, `created_at`.
- Imutável após inserção.

---

## 6. Comunicação

### `whatsapp_messages`

- `id`, `organization_id`, `wa_message_id` unique, `direction` (`in`/`out`), `from_phone`, `to_phone`, `payload jsonb`, `status`, `template_id null`, `idempotency_key`, `created_at`.

### `whatsapp_templates`

- `id`, `meta_template_id`, `name`, `language`, `category`, `body`, `variables`, `status`.

### `chatwoot_conversations`

- `id`, `chatwoot_conversation_id` unique, `chatwoot_inbox_id`, `lead_id`, `customer_id`, `status`, `assignee_chatwoot_id`, `last_synced_at`, `metadata jsonb`.

### `chatwoot_handoffs`

- `id`, `lead_id`, `chatwoot_conversation_id`, `requested_by_kind` (`ai`/`system`), `reason`, `summary text`, `simulation_id null`, `status` (`requested`, `assigned`, `completed`, `failed`), `assigned_agent_id null`, `created_at`, `completed_at null`.

### `interactions`

- Visão unificada de todas as interações com o lead (mensagens, ligações, anotações).
- `id`, `lead_id`, `kind` (`whatsapp_message`, `chatwoot_note`, `internal_note`, `system_event`), `direction`, `body`, `actor_kind`, `actor_id`, `metadata`, `created_at`.

---

## 7. IA

### `ai_conversation_states`

- `id`, `conversation_id` (= `chatwoot_conversation_id` ou identificador interno), `lead_id`, `current_node`, `state jsonb`, `prompt_version`, `graph_version`, `last_message_at`, `created_at`, `updated_at`.
- Único por conversa ativa.

### `ai_decision_logs`

- `id`, `conversation_id`, `lead_id null`, `node_name`, `decision`, `inputs jsonb`, `outputs jsonb`, `tools_called jsonb`, `prompt_version`, `model_used`, `latency_ms`, `error null`, `created_at`.

### `assistant_queries`

- Logs do assistente interno.
- `id`, `user_id`, `role_at_query`, `query_text`, `tools_called jsonb`, `response_text`, `actions_requested jsonb`, `actions_confirmed jsonb`, `latency_ms`, `created_at`.

### `prompt_versions`

- Catálogo: `id`, `key`, `version`, `body`, `model_recommended`, `notes`, `created_by`, `created_at`. Imutável após publicação.

---

## 8. Automação

### `followup_rules` (gated por flag)

- `id`, `key` (`d1`, `d3`, `d7`, `d15`), `trigger_type` (`stage_inactivity`, `event_based`), `wait_hours`, `template_id`, `is_active`, `applies_to_stage`, `applies_to_outcome`.

### `followup_jobs`

- `id`, `lead_id`, `rule_id`, `scheduled_at`, `status` (`scheduled`, `triggered`, `sent`, `failed`, `cancelled`, `customer_replied`), `attempt_count`, `last_error`, `idempotency_key unique (lead_id, rule_id, day_bucket)`.

### `payment_dues`

- `id`, `customer_id`, `contract_reference`, `installment_number`, `due_date`, `amount`, `status` (`pending`, `paid`, `overdue`, `renegotiated`), `paid_at null`, `origin` (`manual`, `import`), `created_by`.

### `collection_rules` / `collection_jobs`

- Espelho de followup, para cobrança. Mesma estrutura.

---

## 9. Importação

### `import_batches`

| Coluna                   | Tipo                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| id                       | uuid PK                                                                                                  |
| kind                     | text CHECK (`leads`, `customers`, `analyses`, `payments`, `notion_history`, `trello_history`)            |
| status                   | text CHECK (`uploaded`, `parsing`, `ready_for_review`, `processing`, `completed`, `failed`, `cancelled`) |
| source_filename          | text                                                                                                     |
| source_storage_key       | text                                                                                                     | path/blob key                       |
| column_mapping           | jsonb                                                                                                    |                                     |
| stats                    | jsonb                                                                                                    | totais válidas/inválidas/duplicadas |
| created_by               | uuid FK users                                                                                            |
| created_at, completed_at |                                                                                                          |

### `import_rows`

- `id`, `batch_id`, `row_number`, `raw jsonb`, `normalized jsonb null`, `status` (`pending`, `valid`, `invalid`, `duplicate`, `imported`, `error`), `errors jsonb`, `entity_id null`, `processed_at`.

### `import_errors`

- Detalhe de erro por campo. `id`, `row_id`, `field`, `code`, `message`.

### `import_mappings`

- Templates salvos de mapeamento por usuário/kind.

---

## 10. Eventos e auditoria

### `event_outbox`

| Coluna                   | Tipo                                                               |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| id                       | uuid PK                                                            |
| event_id                 | uuid unique                                                        | id lógico do evento                |
| event_name               | text                                                               | ver [04-eventos.md](04-eventos.md) |
| aggregate_type           | text                                                               |
| aggregate_id             | uuid                                                               |
| payload                  | jsonb                                                              |
| status                   | text CHECK (`pending`, `processing`, `processed`, `failed`, `dlq`) |
| attempts                 | int default 0                                                      |
| last_error               | text null                                                          |
| available_at             | timestamptz default now()                                          |
| created_at, processed_at |                                                                    |

Índice `idx_outbox_pending (status, available_at)` parcial onde `status='pending'`.

### `event_processing_logs`

- Histórico de processamento por handler. `id`, `event_id`, `handler_name`, `status`, `started_at`, `finished_at`, `error null`.
- Unique `(event_id, handler_name)` para idempotência.

### `audit_logs`

- `id`, `actor_user_id null`, `actor_kind` (`user`, `ai`, `system`, `worker`), `action` (`update_credit_analysis`, `change_kanban_stage`, `change_feature_flag`...), `entity_type`, `entity_id`, `before jsonb`, `after jsonb`, `ip null`, `user_agent null`, `correlation_id`, `created_at`.

### `idempotency_keys`

- `id`, `endpoint`, `key`, `request_hash`, `response_status`, `response_body`, `expires_at`.

---

## 11. Feature flags

### `feature_flags`

| Coluna        | Tipo                                                |
| ------------- | --------------------------------------------------- | -------------------------------------- |
| id            | uuid PK                                             |
| key           | text unique                                         | `crm.enabled`, `followup.enabled`, ... |
| name          | text                                                |
| description   | text                                                |
| status        | text CHECK (`enabled`, `disabled`, `internal_only`) |
| visible       | bool default true                                   |
| ui_label      | text null                                           |
| dependencies  | text[]                                              | outras flags requeridas                |
| allowed_roles | text[]                                              |
| updated_by    | uuid FK users null                                  |
| updated_at    | timestamptz                                         |

### `feature_flag_audit`

- Audit de alterações. `flag_key`, `before`, `after`, `actor_user_id`, `created_at`.

---

## 12. Job system genérico

### `jobs`

- `id`, `queue`, `name`, `payload jsonb`, `status` (`pending`, `running`, `completed`, `failed`, `cancelled`), `priority`, `run_at`, `attempts`, `max_attempts`, `last_error`, `lock_token`, `locked_until`.

---

## 13. Diagrama lógico (textual)

```
organizations 1—N users 1—N user_roles N—1 roles N—M permissions
organizations 1—N cities 1—N agent_city_assignments N—1 agents
agents 1—1 users
leads N—1 customers (opcional)
leads 1—1 kanban_cards
leads 1—N credit_simulations
leads 1—N credit_analyses 1—N credit_analysis_versions
credit_simulations N—1 credit_product_rules
credit_simulations N—1 credit_products
chatwoot_conversations N—1 leads
whatsapp_messages N—1 chatwoot_conversations (via lead)
ai_conversation_states 1—1 chatwoot_conversations
ai_decision_logs N—1 ai_conversation_states
followup_jobs N—1 leads N—1 followup_rules
payment_dues N—1 customers
collection_jobs N—1 payment_dues
import_batches 1—N import_rows
event_outbox: independente, por aggregate_id polimórfico
audit_logs: polimórfico
```

## 14. Retenção e LGPD

| Dado                  | Política                                                            |
| --------------------- | ------------------------------------------------------------------- |
| whatsapp_messages     | 24 meses ativos, depois arquivados                                  |
| ai_decision_logs      | 12 meses, depois agregados                                          |
| audit_logs            | mínimo 5 anos para ações sensíveis (credit_analyses, feature_flags) |
| customer documents    | enquanto cliente ativo + 5 anos pós-encerramento                    |
| leads não convertidos | 24 meses sem atividade → marcação `archived` + redução de PII       |

Apagamento por solicitação LGPD: rotina específica que pseudonimiza `customers` e `leads` e mantém audit.
