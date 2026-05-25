# 19 — Runbook de Go-Live

> Documento operacional do cutover Elemento. Criado no slot [`F7-S06`](../tasks/slots/F7/F7-S06-runbook-go-live.md). Atualizar a cada exercício de rollback ou incidente real.
>
> **Regra de uso:** qualquer dúvida durante o cutover ou operação paralela — este doc vence. Se um procedimento abaixo contradiz um Slack ou e-mail, este doc vence. Se algo mudou na infra, atualizar aqui antes de fechar o incidente.

---

## 1. Pré-requisitos

Todos os itens abaixo devem estar marcados como `done` (ou explicitamente "aceito como risco documentado" pelo CTO) antes do D0. Risco aceito exige aprovação escrita no canal de incident + registro neste doc.

### 1.1 Slots de produto (implementação)

| Slot | Descrição | Status |
|------|-----------|--------|
| [F7-S01](../tasks/slots/F7/F7-S01-kimi-k2-default-model.md) | Kimi K2 como modelo padrão | ✅ done |
| [F4-S01](../tasks/slots/F4/F4-S01-schema-credit-analyses.md) | Schema de análise de crédito | ✅ done |
| [F4-S02](../tasks/slots/F4/F4-S02-backend-credit-analyses-api.md) | API de análise de crédito | ✅ done |
| [F7-S02](../tasks/slots/F7/F7-S02-ci-e2e-smoke.md) | Smoke E2E verde no CI | ✅ done |
| [F7-S03](../tasks/slots/F7/F7-S03-hardening-f3-pre-prod.md) | Hardening F3 fechado | ✅ done |
| [F7-S04](../tasks/slots/F7/F7-S04-importacao-notion-prod.md) | Importação Notion validada em staging | ✅ done |
| [F7-S07](../tasks/slots/F7/F7-S07-staging-paralelo.md) | Importação em staging conferida com cliente | ⬜ pendente |
| [F7-S08](../tasks/slots/F7/F7-S08-treinamento.md) | Treinamento dos agentes humanos 100% | ⬜ pendente |

### 1.2 Requisitos legais e contratuais

- [ ] DPIA aprovado pelo DPO (ver [docs/17-lgpd-protecao-dados.md §11](17-lgpd-protecao-dados.md))
- [ ] Contrato com Banco do Povo assinado por ambas as partes
- [ ] DPA assinado com OpenRouter (suboperador LLM)
- [ ] DPA assinado com Meta (suboperador WhatsApp)
- [ ] DPA ou confirmação formal de que Notion não processa mais PII em produção após cutover
- [ ] RoPA atualizado com novos fluxos de dados do Elemento

### 1.3 Requisitos operacionais

- [ ] Equipe de plantão designada (ver §12) e disponível no canal de incident
- [ ] Janela de cutover comunicada ao cliente por escrito ≥ 72h antes
- [ ] Script `scripts/smoke-prod.ps1` testado contra staging com saída verde (exit code 0)
- [ ] Plano de rollback exercitado ao menos uma vez em staging (registrar data + RTO medido abaixo)

> **Registro de exercício de rollback em staging:**
> Data: _____ | RTO medido: _____ min | Responsável: _____ | Observações: _____

---

## 2. Inventário de infra

Preencher antes do D-7. Campos `A definir` devem ser preenchidos pelo cliente + Rogério.

| Componente | Host / URL | Versão / runtime | Backup | Responsável | Observabilidade |
|---|---|---|---|---|---|
| Postgres | A definir com cliente | 16-alpine | Snapshot diário + WAL streaming | Equipe Elemento | `pg_stat_statements`, slow query log (> 200ms) |
| API (Node) | Container — A definir | Node 20.11.0 / Fastify 5 | — (stateless) | Equipe Elemento | Pino structured logs, `/health` |
| LangGraph (Python) | Container — A definir | Python 3.12 / FastAPI | — (stateless) | Equipe Elemento | structlog, `/health` |
| Worker outbox | Container (mesmo image da API) | — | — | Equipe Elemento | Logs Pino + `outbox_lag_seconds` |
| Chatwoot | Self-hosted do cliente OU SaaS | A definir | Responsabilidade do cliente | TI SEDEC-RO | Webhook outbound configurado para Elemento |
| Meta WhatsApp Cloud API | Meta | Graph API v20.0 | — | Equipe Elemento | Template approval status — verificar no Meta Business Manager |
| Object storage (anexos) | A definir (S3/MinIO/equiv.) | — | Versionado + cifrado at-rest | A definir | Métricas de bucket, alertas de fill |

### 2.1 URLs canônicas (preencher antes do D-3)

```
API prod:          https://___________________
LangGraph prod:    http://langgraph:8000 (interno) / https://_____________ (externo se exposto)
Chatwoot prod:     https://___________________
Meta webhook URL:  https://___________________ /webhooks/meta/whatsapp
```

### 2.2 Healthcheck endpoints

```
GET https://<API_URL>/health         → 200 { "status": "ok", "version": "..." }
GET https://<LANGGRAPH_URL>/health   → 200 { "status": "ok" }
```

Ambos devem responder em < 2s. Se não responderem, o cutover não começa.

---

## 3. Configuração de env por ambiente

> **Regra:** nenhuma var de produção pode ser inserida diretamente no repositório, nem em `.env` versionado. Toda var sensível vem do cofre do cliente.

| Var | Staging | Produção | Origem do secret |
|---|---|---|---|
| `NODE_ENV` | `staging` | `production` | — |
| `DATABASE_URL` | `postgres://elemento_staging@…` | `postgres://elemento_prod@…` | Cofre do cliente |
| `JWT_ACCESS_SECRET` | gerado (≥ 64 chars) | gerado (≥ 64 chars, distinto do staging) | Cofre do cliente |
| `JWT_REFRESH_SECRET` | gerado (≥ 64 chars) | gerado (≥ 64 chars, distinto do access) | Cofre do cliente |
| `LANGGRAPH_INTERNAL_TOKEN` | gerado (≥ 64 chars) | gerado (≥ 64 chars) | Cofre do cliente |
| `API_PUBLIC_URL` | `https://staging.elemento…` | `https://elemento…` | DNS |
| `LANGGRAPH_BASE_URL` | `http://langgraph:8000` | `http://langgraph:8000` | — |
| `OPENROUTER_API_KEY` | conta dev | conta prod (budget separado) | OpenRouter dashboard |
| `LLM_MODEL_CLASSIFIER` | `anthropic/claude-3.5-haiku` | `anthropic/claude-3.5-haiku` | — |
| `LLM_MODEL_REASONER` | `moonshot/kimi-k2` | `moonshot/kimi-k2` | — |
| `LLM_MODEL_FALLBACK` | `anthropic/claude-sonnet-4` | `anthropic/claude-sonnet-4` | — |
| `LLM_DAILY_BUDGET_USD` | `5` | `50` (ajustável) | — |
| `CHATWOOT_BASE_URL` | URL Chatwoot staging/dev | URL Chatwoot prod do cliente | — |
| `CHATWOOT_API_KEY` | conta dev | conta prod | Chatwoot admin |
| `META_WHATSAPP_ACCESS_TOKEN` | sandbox | prod (BSP) | Meta Business Manager |
| `META_WHATSAPP_PHONE_NUMBER_ID` | sandbox | prod | Meta Business Manager |
| `META_WHATSAPP_VERIFY_TOKEN` | gerado | gerado | Cofre do cliente |
| `FX_BRL_PER_USD` | `5.75` | atualizado mensalmente | Manual / cron futuro |
| `FOLLOWUP_SCHEDULER_TICK_MS` | `60000` | `60000` | — |
| Feature flags `followup.*` | `disabled` | `disabled` (até onda 2) | DB seed / UI |
| Feature flags `billing.*` | `disabled` | `disabled` (até onda 3) | DB seed / UI |

### 3.1 Validação de env antes do deploy

Executar antes de subir o container em produção:

```bash
# Verificar que nenhuma var obrigatória está ausente
docker compose run --rm api node -e "require('./dist/lib/env').env" 2>&1
# Deve imprimir as vars parseadas sem erro. Qualquer erro de Zod = variável faltando.
```

---

## 4. Secrets

### 4.1 Armazenamento

- **Cofre do cliente:** 1Password Business / AWS Secrets Manager / equivalente (a definir junto com TI SEDEC-RO antes do D-7).
- **Equipe Elemento:** acesso via cofre compartilhado durante o projeto. Revogar acesso Elemento no offboarding em ≤ 24h.
- **NUNCA** commitar `.env` real, mesmo cifrado. `.env.example` é a única referência versionada.

### 4.2 Rotação

| Secret | Rotação mínima | Quem rotaciona |
|---|---|---|
| `JWT_ACCESS_SECRET` | Anual | Equipe Elemento |
| `JWT_REFRESH_SECRET` | Anual | Equipe Elemento |
| `LANGGRAPH_INTERNAL_TOKEN` | Anual | Equipe Elemento |
| `OPENROUTER_API_KEY` | Semestral | Equipe Elemento |
| `META_WHATSAPP_ACCESS_TOKEN` | Conforme política Meta | Equipe Elemento |
| `CHATWOOT_API_KEY` | Anual | TI SEDEC-RO |
| DB password | Anual | TI SEDEC-RO |

### 4.3 Lista canônica de secrets

Arquivo `elemento-prod-secrets.txt` cifrado com GPG armazenado no cofre do cliente. Contém: nome da var, valor, data de rotação, próxima rotação.

### 4.4 Procedimento de rotação de JWT em produção

1. Gerar novo secret (`openssl rand -hex 64`)
2. Atualizar no cofre
3. Reiniciar API (`docker compose restart api`) — usuários logados precisam fazer login novamente (tokens antigos inválidos)
4. Comunicar se necessário (rotação de emergência = avisar todos)

---

## 5. Checklist pré-cutover (D-7 → D0)

> **Como usar:** marcar cada item com data e responsável. Item não marcado no momento indicado = bloqueio do passo seguinte.

### D-7 (7 dias antes)

- [ ] Backup completo do Notion: export `.zip` markdown + CSV — armazenar no cofre por 12 meses. Responsável: ___
- [ ] DNS apontado para staging — propagação confirmada (`dig +short <domínio>`). Responsável: ___
- [ ] Cert TLS válido por ≥ 30 dias — verificar com `openssl s_client -connect <host>:443 2>/dev/null | openssl x509 -noout -dates`. Responsável: ___
- [ ] Migrations rodadas em staging com cópia **anonimizada** da base de prod (CPF/telefone substituídos por valores fictícios). Responsável: ___
- [ ] Smoke E2E (F7-S02) verde em staging — registrar URL do workflow no PR/issue. Responsável: ___
- [ ] `scripts/smoke-prod.ps1` testado contra staging: saída verde, exit code 0. Responsável: ___
- [ ] Inventário §2 preenchido (todos os `A definir` resolvidos). Responsável: ___

### D-3 (3 dias antes)

- [ ] Feature flags revisadas na UI de prod — `followup.*` e `billing.*` confirmados em `disabled`. Responsável: ___
- [ ] RoPA atualizado (doc 17 §3.3) — PDF assinado no cofre. Responsável: ___
- [ ] DPIA aprovado pelo DPO — cópia no cofre. Responsável: ___
- [ ] Política de retenção configurada — jobs F1-S25 habilitados e testados em staging. Responsável: ___
- [ ] Treinamento dos agentes humanos 100% (F7-S08) — lista nominal de presença arquivada. Responsável: ___
- [ ] Plano de rollback exercitado em staging — registrar data + RTO medido na seção §1 acima. Responsável: ___
- [ ] Canal de incident criado (Slack/Discord/WhatsApp) com cliente + equipe Elemento. Responsável: ___
- [ ] DPAs (OpenRouter, Meta) arquivados no cofre. Responsável: ___

### D-1 (1 dia antes)

- [ ] Janela de cutover comunicada ao cliente por escrito: data, hora, duração esperada, contatos de plantão. Responsável: ___
- [ ] Plantão técnico designado e confirmado: Rogério + dev secundário disponíveis no canal de incident. Responsável: ___
- [ ] Snapshot final do banco de staging gerado e arquivado — serve como fallback se prod der problema na importação. Responsável: ___
- [ ] Status page configurado com banner "Manutenção programada" agendado. Responsável: ___
- [ ] TTL de DNS rebaixado para 60s (para rollback rápido). Responsável: ___
- [ ] Checklist D-7 e D-3 100% marcados — se não, GO/NO-GO com CTO. Responsável: ___

### D0 — 30 min antes do cutover

- [ ] Status page: banner "Manutenção programada em andamento". Responsável: ___
- [ ] Webhook WhatsApp/Chatwoot do sistema antigo desligado. Responsável: ___
- [ ] Confirmação verbal (canal de incident) de toda a equipe de plantão presentes. Responsável: ___

---

## 6. Procedimento de cutover (D0)

> Horário sugerido: sábado 22h → domingo 02h (janela de menor volume de WhatsApp).
> Todos os horários são Hora de Brasília (BRT, UTC-3).
> Cada passo tem um responsável e uma ação de validação ("done when...").

| Hora | Passo | Ação | Done when... | Resp. |
|------|-------|------|--------------|-------|
| 22:00 | Congelar Notion | Setar todos os usuários Notion como read-only | Nenhum campo editável na UI do Notion | ___ |
| 22:05 | Confirmar plantão | Check no canal de incident: todos presentes | "👍 presente" de cada membro | ___ |
| 22:15 | Snapshot final Notion | Rodar script de export Notion (F7-S07) | Arquivo `.zip` gerado e tamanho > snapshot anterior | ___ |
| 22:30 | Rodar migrations em prod | `pnpm --filter @elemento/api db:migrate` no container prod | Saída `No pending migrations` ou todas aplicadas sem erro | ___ |
| 22:45 | Importação Notion em prod | `pnpm --filter @elemento/api import:notion -- --env prod` | Registrar `batch_id`: _____ | ___ |
| 23:15 | Importação análises CSV | `pnpm --filter @elemento/api import:analyses -- --env prod` | Registrar `batch_id`: _____ | ___ |
| 23:30 | Validar contagem | Contar leads importados vs Notion: `SELECT COUNT(*) FROM leads` | Delta ≤ 1% do total esperado (ou aceitar explicitamente) | ___ |
| 23:45 | Apontar webhook | Atualizar URL do webhook no Meta Business Manager e Chatwoot para Elemento prod | Mensagem de teste aparece em `whatsapp_messages` | ___ |
| 00:00 | Smoke pós-deploy | `./scripts/smoke-prod.ps1 -BaseUrl <URL> -AdminToken <token>` | Exit code **0** — se for 2, acionar rollback imediatamente | ___ |
| 00:15 | Teste de fluxo real | Enviar mensagem de teste pelo número de QA → aguardar resposta IA | Resposta recebida < 15s, lead aparece no Kanban | ___ |
| 00:30 | Comunicar agentes | Mensagem no grupo de operações: "Elemento ativo em produção" | Pelo menos 1 agente confirma acesso ao Manager | ___ |
| 00:45 | Status page | Remover banner de manutenção, postar "Operacional" | Status page verde | ___ |
| 01:00 | Plantão ativo | Monitorar dashboards, métricas, alertas | — | Rogério |

### 6.1 Critério de GO / NO-GO no D0

Antes de qualquer passo após as 22:00, avaliar:

- Smoke em staging verde nas últimas 6h? **Se não: NO-GO, remarcar janela.**
- Todos os itens D-1 marcados? **Se não: NO-GO sem aprovação do CTO.**
- Canal de incident ativo com todos presentes? **Se não: NO-GO.**

---

## 7. Plano de rollback

### 7.1 Gatilhos automáticos (qualquer um dispara ação imediata)

| Gatilho | Limiar | Janela de observação |
|---|---|---|
| Taxa de erro 5xx da API | > 5% | 5 min contínuos |
| Latência p95 do LangGraph | > 8s | 10 min contínuos |
| Outbox lag | > 15 min | — |
| Falha de envio template Meta | > 20 em 1h | — |
| Smoke `exit code 2` | qualquer | — |

### 7.2 Gatilhos manuais (decisão do CTO)

- Vazamento de PII confirmado
- Perda de dados detectada (lead ou análise não encontrado)
- Falha de autenticação sistêmica
- Decisão executiva do CTO por qualquer razão operacional

### 7.3 Passos de rollback

**RTO objetivo: ≤ 30 min**

| Hora | Passo | Comando / Ação |
|------|-------|----------------|
| +0 min | Acionar canal de incident | Mensagem: "ROLLBACK INICIADO — [motivo] — todos em standby" |
| +2 min | Reverter DNS | Apontar de volta para sistema antigo (TTL já está em 60s desde D-1) |
| +5 min | Desligar webhook Meta | Remover URL do Elemento no Meta Business Manager |
| +7 min | Desligar webhook Chatwoot | Remover URL do Elemento nas configurações de webhook do Chatwoot |
| +10 min | Parar containers Elemento | `docker compose stop api langgraph workers` |
| +12 min | Reativar escritas Notion | Restaurar permissões de edição para usuários |
| +15 min | Anunciar reversão | Mensagem para agentes: "Sistema anterior restaurado. Usar Notion normalmente." |
| +20 min | Validar sistema antigo | Enviar mensagem de teste → confirmar resposta via sistema antigo |
| +30 min | Iniciar post-mortem | Template em [`tasks/slots/F7/F7-S09-postmortem.md`](../tasks/slots/F7/F7-S09-postmortem.md) |

### 7.4 Dados importados durante a janela revertida

- Registros importados ficam em `import_batches` com status `cancelled` e `reason: rollback`.
- `leads` criados durante a janela NÃO são deletados — ficam com flag `imported_batch_cancelled: true`.
- Na próxima janela de cutover, nova importação reutiliza os snapshots Notion já gerados (economiza tempo).
- Duplicatas detectadas automaticamente via HMAC do CPF.

### 7.5 Comunicação de rollback

```
Template de mensagem (canal de incident):
---
🔴 ROLLBACK ELEMENTO
Hora: [HH:MM]
Motivo: [descrição objetiva]
Status do sistema antigo: [OK / verificando]
Próximo update: [HH:MM]
Responsável: [nome]
---
```

---

## 8. Operação paralela (D0+1 → D0+7)

### 8.1 Regras

- **Notion:** somente leitura. Proibido criar ou editar leads/análises no Notion após D0.
- **Trello:** não-utilizado desde antes do D0 (substituído pelo Kanban do Elemento).
- **Elemento:** sistema primário para todos os novos atendimentos.

### 8.2 Rotina diária

Executar todo dia às 9h no período D0+1 → D0+7:

1. Stand-up com cliente (15 min): incidentes das últimas 24h, métricas do dia anterior.
2. Rodar `scripts/diff-import-vs-source.ps1` (script de comparação Elemento vs Notion) — registrar divergências em planilha compartilhada.
3. Verificar alertas pendentes — resolver ou escalar P1/P2 antes do fim do stand-up.
4. Atualizar log de operação paralela:

| Data | Leads Elemento | Leads Notion | Delta | Incidentes | Status |
|------|---------------|--------------|-------|-----------|--------|
| D+1 | | | | | |
| D+2 | | | | | |
| ... | | | | | |
| D+7 | | | | | |

### 8.3 Critério de "desativação total" (fim da operação paralela)

Todos os seguintes devem ser verdadeiros no final de D+7:

- [ ] Sem incidente P1 nas últimas 72h
- [ ] Sem incidente P2 aberto (pode ter resolvido, não pode ter aberto sem resolução)
- [ ] Taxa de erro 5xx < 1% nas últimas 48h
- [ ] Latência p95 < 3s nas últimas 48h
- [ ] Contagem de leads Elemento ≥ contagem Notion (delta ≤ 1%)
- [ ] Cliente confirma operação estável **por escrito** (e-mail ou mensagem no canal de incident)
- [ ] Aprovação formal do CTO

Após aprovação: exportar Notion final, arquivar, desativar integrações Notion, comunicar ao cliente que Notion está arquivado.

---

## 9. Smoke test pós-deploy (`scripts/smoke-prod.ps1`)

O script completo está em `scripts/smoke-prod.ps1`. Esta seção documenta o comportamento esperado.

### 9.1 Checks core (exit code 2 se qualquer um falhar)

| # | Check | Endpoint | Critério de sucesso |
|---|-------|----------|---------------------|
| 1 | API health | `GET /health` | HTTP 200, body contém `"status":"ok"` |
| 2 | LangGraph health | `GET <LANGGRAPH_URL>/health` | HTTP 200 |
| 3 | Login QA | `POST /api/auth/login` com credencial QA | HTTP 200, body contém `accessToken` |
| 4 | Dashboard metrics | `GET /api/dashboard/metrics` com token QA | HTTP 200, body é objeto não-vazio |
| 5 | Credit products | `GET /api/credit-products` com token QA | HTTP 200, array com ≥ 1 item |
| 6 | Feature flags | `GET /api/feature-flags` com token QA | HTTP 200, `followup.enabled=false`, `billing.enabled=false` |

### 9.2 Check opcional (exit code 1 se falhar, não 2)

| # | Check | Ação | Critério |
|---|-------|------|---------|
| 7 | WhatsApp QA | `POST /api/internal/test-whatsapp` ou envio direto | Mensagem registrada em `whatsapp_messages` dentro de 30s |

### 9.3 Uso

```powershell
# Smoke básico (sem WhatsApp)
./scripts/smoke-prod.ps1 -BaseUrl https://elemento-prod.com -AdminToken $env:ADMIN_TOKEN

# Smoke completo (com teste de WhatsApp)
./scripts/smoke-prod.ps1 -BaseUrl https://elemento-prod.com -AdminToken $env:ADMIN_TOKEN -Full

# Contra staging
./scripts/smoke-prod.ps1 -BaseUrl https://staging.elemento.com -AdminToken $env:STAGING_TOKEN
```

### 9.4 Interpretação dos exit codes

| Código | Significado | Ação recomendada |
|--------|-------------|-----------------|
| 0 | Todos os checks core passaram, opcionais também | Prosseguir com cutover |
| 1 | Core ok, opcional falhou | Investigar WhatsApp, mas cutover pode prosseguir com monitoramento |
| 2 | Algum check core falhou | **Não prosseguir.** Identificar e corrigir antes de continuar. |

---

## 10. Observabilidade mínima (MVP de produção)

### 10.1 Logs

**Stack mínima para go-live:**

- Containers escrevem em stdout — capturado pelo runtime Docker.
- `docker logs --tail 100 api` / `docker logs --tail 100 langgraph` para diagnóstico imediato.
- **Futuro (pós D0+7):** ingestor de logs centralizado (Loki + Grafana, Datadog, ou equivalente a definir conforme orçamento do cliente).

**Campos canônicos obrigatórios em todo log estruturado:**

```json
{
  "level": "info",
  "time": "2026-05-25T14:30:00.000Z",
  "request_id": "req_abc123",
  "correlation_id": "corr_xyz789",
  "route": "POST /api/leads",
  "user_id": "usr_***masked***",
  "lead_id": "lead_456",
  "conversation_id": "conv_789"
}
```

**PII nunca em log estruturado:** cobertura via `pino.redact` — campos canônicos em [doc 17 §8.3](17-lgpd-protecao-dados.md). Qualquer campo não listado que contenha CPF, telefone, nome completo ou e-mail deve ser adicionado à lista de redact antes do go-live.

**Retenção de logs:**

- Logs de aplicação: 90 dias (conforme RoPA — doc 17)
- Audit logs em DB: 7 anos (doc 17 §5.3)

### 10.2 Métricas

Endpoint `/metrics` compatível com Prometheus (a implementar em slot de infra pós-go-live). Para D0, monitorar via logs + dashboard interno.

| Métrica | Labels | Alerta sugerido | Severidade |
|---------|--------|-----------------|------------|
| `api_http_requests_total` | `route`, `status` | 5xx > 5% em 5 min | P1 |
| `api_http_latency_ms_p95` | `route` | > 2000ms em 10 min | P2 |
| `langgraph_requests_total` | `intent`, `result` | — | — |
| `langgraph_latency_ms_p95` | `node` | > 5000ms em 10 min | P2 |
| `langgraph_handoffs_total` | `reason` | spike > 20/h vs. média | P2 |
| `outbox_lag_seconds` | — | > 600s | P1 |
| `outbox_failed_events_total` | `event_name` | > 10/min | P1 |
| `webhook_whatsapp_received_total` | — | queda > 50% vs 24h média | P1 |
| `webhook_chatwoot_received_total` | — | queda > 50% vs 24h média | P1 |
| `llm_cost_usd_total` | `model` | > `LLM_DAILY_BUDGET_USD` | P1 |

### 10.3 Alertas mínimos para D0+7

Todos os alertas abaixo devem estar configurados antes do D0. Mecanismo de alerta: a definir (UptimeRobot, Prometheus AlertManager, ou Datadog — conforme orçamento).

| Condição | Severidade | Canal | Escalação |
|---|---|---|---|
| API `/health` falha por > 2 min | P1 | PagerDuty / WhatsApp on-call | On-call primário → Rogério |
| LangGraph `/health` falha por > 2 min | P1 | idem | idem |
| Outbox lag > 15 min | P1 | idem | idem |
| Taxa 5xx > 5% em 5 min | P1 | idem | idem |
| LLM cost > 80% do budget diário | P2 | Slack canal técnico | Rogério |
| Falha de template Meta > 10/h | P2 | Slack canal técnico | Rogério |
| Cert TLS expira em ≤ 30 dias | P2 | E-mail | TI SEDEC-RO |

### 10.4 Dashboard interno (D0)

O dashboard em `/dashboard/metrics` da UI cobre:

- Leads criados (hoje / 7 dias)
- Handoffs (hoje / 7 dias)
- Latência média LangGraph
- Custo LLM (hoje / acumulado)
- Outbox: eventos pendentes, eventos com falha
- Usuários online

Este dashboard é a primeira linha de monitoramento durante a operação paralela. Verificar a cada stand-up.

---

## 11. Procedimentos de incidente

### 11.1 Estrutura geral de resposta a incidente

1. Detectar (alerta ou observação manual)
2. Declarar (postar no canal de incident: tipo, hora, impacto estimado)
3. Conter (ação imediata para parar o bleeding)
4. Diagnosticar (root cause analysis — 5 Whys)
5. Remediar (fix + validação)
6. Comunicar (update no canal de incident + clientes afetados se P1)
7. Post-mortem (dentro de 48h para P1, 1 semana para P2)

Template de declaração de incidente:

```
🔴 INCIDENTE DECLARADO
Tipo: [LangGraph down / Postgres lento / etc]
Hora de início: [HH:MM]
Impacto: [X usuários afetados / WhatsApp sem resposta / etc]
Responsável: [nome]
Status: investigando
Próximo update: [HH:MM]
```

---

### 11.2 Playbook: LangGraph down

**Sintomas:** `/health` do LangGraph retorna 5xx ou timeout; mensagens de WhatsApp não recebem resposta IA; handoffs automáticos aumentam.

**Contenção imediata:**
- LangGraph down aciona automaticamente fallback de handoff humano (F3 — sem perda de mensagens no WhatsApp, mensagem entregue a agente humano no Chatwoot).

**Diagnóstico:**

```bash
docker logs langgraph --tail 50
docker inspect langgraph | grep -A5 '"Health"'
```

**Remediação:**

1. Verificar se é OOM (mem): `docker stats langgraph` → se memória > 90%, aumentar limite.
2. Verificar se é loop de crash: identificar exception no log → rollback do último deploy de imagem.
3. Reiniciar container: `docker compose restart langgraph`
4. Testar: `curl <LANGGRAPH_URL>/health`
5. Se persistir > 15 min → escalar para Rogério.

---

### 11.3 Playbook: Postgres lento

**Sintomas:** latência p95 da API > 2s; logs da API com queries lentas (`"duration_ms": >500`); alertas de `pg_stat_activity` com queries longas.

**Diagnóstico:**

```sql
-- queries lentas em execução agora
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 seconds'
  AND state != 'idle';

-- tabelas mais acessadas
SELECT schemaname, relname, seq_scan, idx_scan
FROM pg_stat_user_tables
ORDER BY seq_scan DESC LIMIT 10;
```

**Remediação:**

1. VACUUM + ANALYZE nas tabelas mais quentes:
   ```sql
   VACUUM ANALYZE leads;
   VACUUM ANALYZE kanban_cards;
   VACUUM ANALYZE ai_decision_logs;
   VACUUM ANALYZE event_outbox;
   ```
2. Verificar índice ausente: `EXPLAIN ANALYZE <query lenta>` → se `Seq Scan` em tabela grande, criar índice.
3. Matar query bloqueante se necessário: `SELECT pg_cancel_backend(<pid>)`.
4. Se persistir > 30 min com latência aceitável não restaurada → ampliar instância (vertical scaling).

---

### 11.4 Playbook: Webhook duplicado

**Sintomas:** lead criado duas vezes; mensagem do WhatsApp processada duas vezes; `ai_decision_logs` com dois registros para o mesmo `message_id`.

**Diagnóstico:**

```sql
-- Verificar se idempotência funcionou
SELECT * FROM idempotency_keys WHERE key = '<message_id>' ORDER BY created_at;
```

**Remediação:**

- Se `idempotency_keys` tiver dois registros: bug no mecanismo de dedup → investigar race condition.
- Se tiver um registro: dedup funcionou, o segundo pedido foi ignorado → **sem ação necessária** (log de info).
- Verificar origem: Meta faz retry após timeout de 20s. Se a primeira entrega atrasou, Meta entrega novamente. Isso é esperado e deve ser dedupado.

---

### 11.5 Playbook: Template Meta bloqueado

**Sintomas:** logs com `"error": "template_not_found"` ou `"status": 131009`; follow-up automático parando de enviar; alertas de `llm_cost_usd_total` sem aumento (IA não está sendo chamada).

**Ação imediata (< 5 min):**

1. Desligar flag `followup.sender.enabled` na UI do Manager — impede novos envios tentando usar o template bloqueado.

**Diagnóstico:**

1. Acessar Meta Business Manager → WhatsApp → Message Templates.
2. Verificar status do template: `APPROVED` / `REJECTED` / `PAUSED`.
3. Se `REJECTED`: ler motivo. Geralmente conteúdo não-conforme ou template não aprovado ainda.
4. Se `PAUSED`: qualidade do número caiu — verificar taxa de opt-out e denúncias.

**Remediação:**

- Se `REJECTED`: corrigir conteúdo do template → resubmeter para aprovação (pode levar 24-48h).
- Se `PAUSED` por qualidade: aguardar despausa automática (Meta determina o prazo) e investigar causa.
- Re-ativar flag `followup.sender.enabled` **somente** após template em `APPROVED`.

---

### 11.6 Playbook: Vazamento de PII (CRÍTICO — P1 imediato)

**ATENÇÃO:** Este é o cenário mais crítico. Seguir à risca.

**Gatilho:** CPF, telefone, nome completo ou dados sensíveis encontrados em log externo, response de API não autorizada, mensagem WhatsApp, ou comunicação com terceiros não autorizados.

**Ação imediata (< 5 min):**

1. **Acionar DPO imediatamente** — não esperar diagnóstico completo.
2. **Postar no canal de incident:**
   ```
   🔴 INCIDENTE DE PII — P1 CRÍTICO
   Hora: [HH:MM]
   O que foi encontrado: [descrição sem reproduzir os dados]
   Onde: [log / response / mensagem]
   Impacto estimado: [N titulares potencialmente afetados]
   DPO notificado: Sim
   ```
3. **Conter:** se o vazamento está em resposta de API — desligar a rota afetada imediatamente (`feature flag` ou nginx deny). Se está em log externo — acionar provedor para remoção.

**Diagnóstico:**

1. Identificar escopo: quais campos, quais registros, qual período.
2. Identificar vetor: bug de código? Configuração de log? Acesso não autorizado?
3. Identificar titulares afetados: listagem nominal (com CPF mascarado para uso interno).

**Notificação à ANPD:**

- Se o vazamento afetar titulares e representar risco relevante: notificação à ANPD em **≤ 72h** após confirmação (doc 17 §10).
- DPO redige a notificação; Rogério aprova; envio via canal da ANPD.

**Remediação:**

1. Corrigir bug ou configuração causadora.
2. Auditar logs para identificar todo o escopo do vazamento.
3. Notificar titulares afetados se exigido pela ANPD.
4. Post-mortem público interno + remediation plan com prazo.

---

## 12. Contatos e plantão

### 12.1 Tabela de contatos

| Papel | Pessoa | Contato primário | Contato secundário | Escalação |
|---|---|---|---|---|
| On-call primário (D0..D0+7) | Rogério Viana | WhatsApp: ____________ | rogerio5566.ro@gmail.com | — |
| On-call secundário | A definir | — | — | Rogério |
| DPO técnico | A definir | — | — | Rogério |
| Gestor Banco do Povo (operação) | A definir | — | — | — |
| TI SEDEC-RO (infra) | A definir | — | — | Rogério |
| Suporte OpenRouter | support@openrouter.ai | — | — | Rogério |
| Suporte Meta Business | Meta Business Help | — | — | Rogério |

### 12.2 SLA por severidade

| Severidade | Definição | Tempo de resposta | Resolução objetivo |
|---|---|---|---|
| P1 — Critical | Sistema fora do ar / vazamento PII / perda de dados | ≤ 15 min | ≤ 2h |
| P2 — High | Funcionalidade core degradada (WhatsApp respondendo lento, handoff falhando) | ≤ 1h | ≤ 8h |
| P3 — Medium | Funcionalidade secundária com problemas (dashboard, exportação) | ≤ 4h | ≤ 48h |
| P4 — Low | Cosmético / não-bloqueante | ≤ 24h | Sprint planning |

### 12.3 Escalonamento

```
Usuário reporta incidente via agente humano no Chatwoot
  → Agente abre issue no canal de incident
  → On-call secundário assume em < 15 min se P1
  → Rogério (on-call primário) entra se on-call secundário não resolver em 30 min
  → Se P1 envolver PII: DPO notificado em paralelo, não depois
```

---

## Histórico de revisões

| Data | Versão | Autor | Mudança |
|---|---|---|---|
| 2026-05-22 | 1.0 | Slot F7-S06 | Criação inicial a partir da auditoria pré-launch |
| 2026-05-25 | 1.1 | Slot F7-S06 | Consolidação completa: bloqueadores marcados done (F7-S01, F4-S01, F4-S02, F7-S02, F7-S03, F7-S04), seções expandidas (GO/NO-GO, rotação secrets, desfecho paralelo, playbooks detalhados, tabela de cutover, contatos), smoke-prod.ps1 referenciado |
