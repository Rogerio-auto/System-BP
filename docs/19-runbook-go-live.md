# 19 — Runbook de Go-Live

> Documento operacional do cutover Elemento. Versão inicial criada em 2026-05-22 a partir do slot [`F7-S06`](../tasks/slots/F7/F7-S06-runbook-go-live.md). Atualizar a cada exercício de rollback ou incidente.

## 1. Pré-requisitos

Todos os itens abaixo devem estar `done` ou explicitamente "aceito como risco" pelo CTO antes do D0:

- [ ] [`F7-S01`](../tasks/slots/F7/F7-S01-kimi-k2-default-model.md) — Kimi K2 default
- [ ] [`F4-S01`](../tasks/slots/F4/F4-S01-schema-credit-analyses.md) + [`F4-S02`](../tasks/slots/F4/F4-S02-backend-credit-analyses-api.md) — Análise de crédito persiste
- [ ] [`F7-S02`](../tasks/slots/F7/F7-S02-ci-e2e-smoke.md) — Smoke E2E verde no CI
- [ ] [`F7-S03`](../tasks/slots/F7/F7-S03-hardening-f3-pre-prod.md) — Hardening F3 fechado
- [ ] [`F7-S07`](../tasks/slots/F7/F7-S07-staging-paralelo.md) — Importação em staging conferida com cliente
- [ ] [`F7-S08`](../tasks/slots/F7/F7-S08-treinamento.md) — Treinamento dos agentes 100%
- [ ] DPIA aprovado (ver [`docs/17-lgpd-protecao-dados.md §11`](17-lgpd-protecao-dados.md))
- [ ] Contrato com Banco do Povo assinado
- [ ] DPA com OpenRouter + Meta + (temporariamente) Notion arquivados

## 2. Inventário de infra

| Componente              | Host esperado                    | Versão / runtime         | Backup                             | Observabilidade                             |
| ----------------------- | -------------------------------- | ------------------------ | ---------------------------------- | ------------------------------------------- |
| Postgres                | A definir com cliente            | 16-alpine                | Snapshot diário + WAL              | `pg_stat_statements`, slow queries log      |
| API (Node)              | Container                        | Node 20.11.0 / Fastify 5 | — (stateless)                      | Pino structured logs, healthcheck `/health` |
| LangGraph (Python)      | Container                        | Python 3.12 / FastAPI    | — (stateless)                      | structlog, healthcheck `/health`            |
| Worker outbox           | Container (mesmo image da API)   | —                        | —                                  | Logs Pino + métrica `outbox.lag_seconds`    |
| Chatwoot                | Self-hosted do cliente OU SaaS   | —                        | Responsabilidade do cliente        | Webhook outbound configurado                |
| Meta WhatsApp Cloud API | Meta                             | Graph API v20.0          | —                                  | Template approval status manual             |
| Object storage (anexos) | A definir (S3/MinIO/equivalente) | —                        | Versionado + criptografado at-rest | Métricas de bucket                          |

## 3. Configuração de env por ambiente

| Var                             | Staging                           | Produção                     | Origem do secret     |
| ------------------------------- | --------------------------------- | ---------------------------- | -------------------- |
| `NODE_ENV`                      | `staging`                         | `production`                 | —                    |
| `DATABASE_URL`                  | `postgres://elemento_staging@…`   | `postgres://elemento_prod@…` | Cofre do cliente     |
| `JWT_ACCESS_SECRET`             | gerado                            | gerado, ≥ 64 chars           | Cofre do cliente     |
| `JWT_REFRESH_SECRET`            | gerado                            | gerado, ≥ 64 chars, distinto | Cofre do cliente     |
| `LANGGRAPH_INTERNAL_TOKEN`      | gerado                            | gerado, ≥ 64 chars           | Cofre do cliente     |
| `API_PUBLIC_URL`                | `https://staging.elemento…`       | `https://elemento…`          | DNS                  |
| `LANGGRAPH_BASE_URL`            | `http://langgraph:8000` (interno) | `http://langgraph:8000`      | —                    |
| `OPENROUTER_API_KEY`            | conta dev                         | conta prod                   | OpenRouter dashboard |
| `LLM_MODEL_CLASSIFIER`          | `anthropic/claude-3.5-haiku`      | `anthropic/claude-3.5-haiku` | —                    |
| `LLM_MODEL_REASONER`            | `moonshot/kimi-k2`                | `moonshot/kimi-k2`           | —                    |
| `LLM_MODEL_FALLBACK`            | `anthropic/claude-sonnet-4`       | `anthropic/claude-sonnet-4`  | —                    |
| `LLM_DAILY_BUDGET_USD`          | `5`                               | `50` (ajustável)             | —                    |
| `CHATWOOT_BASE_URL`             | URL Chatwoot do cliente           | URL Chatwoot do cliente      | —                    |
| `CHATWOOT_API_KEY`              | conta dev                         | conta prod                   | Chatwoot admin       |
| `META_WHATSAPP_ACCESS_TOKEN`    | sandbox                           | prod                         | Meta BSP             |
| `META_WHATSAPP_PHONE_NUMBER_ID` | sandbox                           | prod                         | Meta BSP             |
| `FX_BRL_PER_USD`                | `5.75`                            | atualizado mensalmente       | Manual / cron futuro |
| `FOLLOWUP_SCHEDULER_TICK_MS`    | `60000`                           | `60000`                      | —                    |
| Feature flags `followup.*`      | `disabled`                        | `disabled` (até onda 2)      | DB seed              |
| Feature flags `billing.*`       | `disabled`                        | `disabled` (até onda 3)      | DB seed              |

## 4. Secrets

- **Armazenamento:** cofre do cliente (1Password Business / AWS Secrets Manager / equivalente — a definir).
- **Rotação mínima:** anual para JWT/internal token, semestral para API keys de terceiros (OpenRouter, Meta).
- **Acesso:** lista canônica em arquivo cifrado no cofre. Revogar acesso no offboarding em ≤ 24h.
- **NUNCA** commitar `.env` real, mesmo cifrado. `.env.example` é a única referência versionada.

## 5. Checklist pré-cutover (D-7 → D0)

### D-7

- [ ] Backup completo do Notion (export `.zip` markdown + CSV) — armazenar no cofre por 12 meses
- [ ] DNS apontado para staging — propagação confirmada (`dig`)
- [ ] Cert TLS válido por ≥ 30 dias (`openssl s_client`)
- [ ] Migrations rodadas em staging com cópia anonimizada da base de prod
- [ ] Smoke E2E (F7-S02) verde em staging — print do workflow no PR

### D-3

- [ ] Feature flags revisadas — `followup.*` e `billing.*` confirmados em `disabled`
- [ ] RoPA atualizado ([doc 17 §3.3](17-lgpd-protecao-dados.md))
- [ ] DPIA aprovado pelo DPO
- [ ] Política de retenção configurada (jobs F1-S25 ligados)
- [ ] Treinamento dos agentes 100% (F7-S08) — lista nominal de presença
- [ ] Plano de rollback exercitado em staging — registrar tempo de execução (RTO esperado: ≤ 30 min)

### D-1

- [ ] Janela de cutover comunicada ao cliente (sugestão: sábado 22h → domingo 02h)
- [ ] Plantão técnico designado: Rogério + dev secundário disponíveis
- [ ] Canal de incident (Slack/Discord/WhatsApp) criado com cliente
- [ ] Snapshot final do banco de staging para referência

### D0 — 30min antes

- [ ] Status page com banner "Manutenção programada"
- [ ] Webhook WhatsApp/Chatwoot do sistema antigo desligado
- [ ] Smoke local da prod final (script `scripts/smoke-prod.ps1`)

## 6. Procedimento de cutover (D0)

1. **22:00** — Congelar escritas no Notion (read-only para todos os usuários)
2. **22:15** — Snapshot final Notion (script já versionado)
3. **22:30** — Restaurar snapshot anonimizado em prod → rodar migrations finais
4. **22:45** — Rodar importação Notion (F7-S04) em prod → registrar `batch_id`
5. **23:15** — Rodar importação análises CSV (F4-S06) em prod → registrar `batch_id`
6. **23:45** — Apontar webhook WhatsApp/Chatwoot para Elemento prod
7. **00:00** — Smoke `scripts/smoke-prod.ps1` → confirmar exit code 0
8. **00:15** — Mensagem de teste no número de QA → verificar resposta da IA
9. **00:30** — Comunicar agentes (Slack/Discord/WhatsApp): "Elemento ativo"
10. **00:45** — Status page: remover banner; postar "Operacional"
11. **01:00 → 09:00** — Plantão ativo monitorando dashboards/alertas

## 7. Plano de rollback

### Gatilhos automáticos

- Taxa de erro 5xx da API > 5% em janela de 5 min
- Latência p95 do LangGraph > 8s em janela de 10 min
- Outbox lag > 15 min
- Falha de envio template Meta > 20 em 1h

### Gatilhos manuais

- Vazamento de PII confirmado
- Perda de dados detectada (lead/análise não encontrado)
- Decisão executiva do CTO

### Passos de rollback (RTO objetivo: 30 min)

1. **+0min** — Acionar canal de incident
2. **+2min** — Reverter DNS para sistema antigo (TTL pré-configurado para 60s)
3. **+5min** — Desligar webhook Meta apontando para Elemento
4. **+7min** — Parar workers Elemento (`docker compose stop api langgraph workers`)
5. **+10min** — Reativar escritas Notion
6. **+15min** — Anunciar reversão para agentes
7. **+30min** — Iniciar post-mortem (template em [`tasks/slots/F7/F7-S09-postmortem.md`](../tasks/slots/F7/F7-S09-postmortem.md))

### Dados imported durante a janela revertida

- `import_batches` ficam marcados `cancelled` com motivo `rollback`
- Próxima janela de cutover reusa os snapshots já feitos

## 8. Operação paralela (D0+1 → D0+7)

- Notion: **somente leitura** (sem novos registros, mantém histórico para referência)
- Daily standup 9h com cliente (15 min) — reporta incidentes da última 24h
- Comparação diária de leads entre Elemento e Notion (script `scripts/diff-import-vs-source.ps1`)
- Log de divergências em planilha compartilhada
- **Critério de "desativação total" (D+7):**
  - Sem P1 nas últimas 72h
  - Sem P2 não-resolvido
  - Taxa de erro 5xx < 1%
  - Latência p95 < 3s
  - Cliente confirma operação estável por escrito

## 9. Smoke test pós-deploy (`scripts/smoke-prod.ps1`)

Roda os seguintes checks (todos com timeout 10s):

1. `GET /health` na API → expect `200 {"status":"ok"}`
2. `GET /health` no LangGraph → expect `200`
3. `POST /api/auth/login` com credencial de QA → expect token válido
4. `GET /api/dashboard/metrics` com token QA → expect estrutura esperada
5. `GET /api/credit-products` com token QA → expect ≥ 1 produto ativo
6. `GET /api/feature-flags` → confirma `followup.enabled=disabled`, `billing.enabled=disabled`
7. (Opcional, gated por `-Full`) `POST` mensagem de teste no número de QA → aguarda 30s → confirma resposta da IA gravada em `whatsapp_messages`

Exit codes:

- `0` — tudo verde
- `1` — warn (item opcional falhou, mas core ok)
- `2` — fail (algum item core falhou — abortar deploy)

## 10. Observabilidade mínima (MVP de produção)

### Logs

- Centralizar logs dos containers (`docker logs` → ingestion futuro, ex. Loki/Datadog)
- Campos canônicos: `level`, `time`, `request_id`, `correlation_id`, `route`, `user_id` (mascarado), `lead_id`, `conversation_id`
- PII **nunca** em log estruturado (cobertura via `pino.redact` — doc 17 §8.3)

### Métricas (Prometheus-compatible — endpoint `/metrics` a implementar)

| Métrica                           | Labels         | Alerta sugerido                    |
| --------------------------------- | -------------- | ---------------------------------- |
| `langgraph_requests_total`        | intent, result | —                                  |
| `langgraph_latency_ms_p95`        | node           | > 5000ms por 10min → warn          |
| `langgraph_handoffs_total`        | reason         | spike (>20/h) → warn               |
| `outbox_lag_seconds`              | —              | > 600s → critical                  |
| `outbox_failed_events_total`      | event_name     | > 10/min → critical                |
| `webhook_whatsapp_received_total` | —              | drop > 50% vs 24h média → critical |
| `webhook_chatwoot_received_total` | —              | idem                               |
| `api_http_requests_total`         | route, status  | 5xx > 5%/5min → critical           |
| `api_http_latency_ms_p95`         | route          | > 2000ms/10min → warn              |
| `llm_cost_usd_total`              | model          | > LLM_DAILY_BUDGET_USD → critical  |

### Alertas mínimos para D0+7

- API down > 2 min → P1
- LangGraph down > 2 min → P1
- Outbox lag > 15 min → P1
- Taxa 5xx > 5% em 5 min → P1
- LLM cost > 80% do budget diário → P2
- Falha de template Meta > 10/h → P2

## 11. Procedimentos de incidente

### 11.1 LangGraph down

1. Verificar `docker logs langgraph` últimos 5 min
2. Healthcheck `/health` retornando algo?
3. Se loop de crash → identificar exception, rollback do último deploy
4. Enquanto isso: webhook WhatsApp cai em fallback de handoff humano (F3-S34) — sem perda de mensagens

### 11.2 Postgres lento

1. Identificar queries lentas via `pg_stat_statements`
2. Vacuum + analyze nas tabelas mais quentes (leads, kanban_cards, ai_decision_logs, event_outbox)
3. Avaliar índice ausente (consultar plano com `EXPLAIN ANALYZE`)
4. Se persistir > 30 min → ampliar instância

### 11.3 Webhook duplicado

1. Verificar `idempotency_keys` — deveriam estar dedupando
2. Identificar origem (Meta retry vs duplicação real)
3. Sem ação se idempotência funcionou (log de info)

### 11.4 Template Meta bloqueado

1. Verificar status no Meta Business Manager
2. Se bloqueado: desligar flag `followup.sender.enabled` imediatamente
3. Submeter novo template OU corrigir conteúdo
4. Re-ativar flag após aprovação

### 11.5 Vazamento de PII (CRÍTICO)

1. Acionar DPO imediatamente
2. Identificar escopo (log, response API, mensagem WhatsApp, etc)
3. Contenção: derrubar serviço afetado se necessário
4. Iniciar processo de notificação à ANPD (doc 17 §10) em ≤ 24h se vazamento confirmado afetando titulares
5. Post-mortem público interno + remediation plan

## 12. Contatos e plantão

| Papel                       | Pessoa               | Contato        | Escalação |
| --------------------------- | -------------------- | -------------- | --------- |
| On-call primário (D0..D0+7) | Rogério Viana        | WhatsApp/email | —         |
| On-call secundário          | A definir            | —              | Rogério   |
| DPO técnico                 | A definir            | —              | Rogério   |
| Cliente (operação)          | Gestor Banco do Povo | —              | —         |
| Cliente (técnico)           | TI SEDEC-RO          | —              | —         |

### SLA por severidade

| Severidade    | Definição                          | Resposta | Resolução objetivo |
| ------------- | ---------------------------------- | -------- | ------------------ |
| P1 — Critical | Sistema fora do ar / vazamento PII | ≤ 15 min | ≤ 2h               |
| P2 — High     | Funcionalidade core degradada      | ≤ 1h     | ≤ 8h               |
| P3 — Medium   | Funcionalidade secundária          | ≤ 4h     | ≤ 48h              |
| P4 — Low      | Cosmético / não-bloqueante         | ≤ 24h    | Sprint planning    |

---

## Histórico de revisões

| Data       | Versão | Autor       | Mudança                                          |
| ---------- | ------ | ----------- | ------------------------------------------------ |
| 2026-05-22 | 1.0    | Slot F7-S06 | Criação inicial a partir da auditoria pré-launch |
