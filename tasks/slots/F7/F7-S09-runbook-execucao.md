# F7-S09 — Runbook de Execução do Cutover

> **Documento operacional — uso no dia D0 e durante as 168h de operação paralela.**
> Este arquivo é o guia de campo. Para contexto completo, ver `docs/19-runbook-go-live.md`.
> **Regra:** se este documento contradiz qualquer Slack/e-mail, este documento vence.
> Preencher campos em branco (`___`) antes do D-7.

---

## Metadados do cutover

| Campo                       | Valor                                                  |
| --------------------------- | ------------------------------------------------------ |
| Data D0 (planejada)         | ************\_\_\_************                         |
| Janela                      | Sábado \_\_\_ às 22:00 → Dom 02:00 BRT                 |
| On-call primário (D0..D0+7) | Rogério Viana                                          |
| On-call secundário          | ************\_\_\_************                         |
| DPO técnico                 | ************\_\_\_************                         |
| Gestor Banco do Povo        | ************\_\_\_************                         |
| TI SEDEC-RO                 | ************\_\_\_************                         |
| Canal de incident           | ************\_\_\_************                         |
| URL API prod                | ************\_\_\_************                         |
| URL LangGraph prod          | ************\_\_\_************                         |
| URL Chatwoot prod           | ************\_\_\_************                         |
| URL Meta webhook            | ************\_\_\_************ /webhooks/meta/whatsapp |

---

## 1. Gate de entrada — Pré-requisitos para iniciar o cutover

> Todos os itens abaixo devem estar `[x]` antes das 22:00 de D0.
> Qualquer item `[ ]` = **NO-GO** — remarcar janela imediatamente.

### 1.1 Slots de produto

- [ ] F7-S01 (Kimi K2) — done
- [ ] F4-S01 (Schema crédito) — done
- [ ] F4-S02 (API crédito) — done
- [ ] F7-S02 (Smoke E2E CI) — done
- [ ] F7-S03 (Hardening F3) — done
- [ ] F7-S04 (Importação Notion) — done
- [ ] F7-S07 (Staging paralelo + aceitação cliente) — done
- [ ] F7-S08 (Treinamento agentes 100%) — done

### 1.2 Requisitos legais e contratuais

- [ ] DPIA aprovado pelo DPO (doc 17 §11) — cópia no cofre
- [ ] Contrato Banco do Povo assinado por ambas as partes
- [ ] DPA com OpenRouter assinado e arquivado
- [ ] DPA com Meta assinado e arquivado
- [ ] DPA/confirmação formal Notion não processa PII após cutover
- [ ] RoPA atualizado com novos fluxos Elemento — PDF no cofre

### 1.3 Requisitos operacionais

- [ ] Equipe de plantão designada e confirmada no canal de incident
- [ ] Janela comunicada ao cliente por escrito ≥ 72h antes — e-mail arquivado
- [ ] `scripts/smoke-prod.ps1` testado contra staging — exit code 0
- [ ] Plano de rollback exercitado em staging

  > Registro de exercício: Data: **_ | RTO medido: _** min | Responsável: **_ | Obs: _**

- [ ] Inventário §2 do doc 19 preenchido (sem campos "A definir")
- [ ] DNS com TTL rebaixado para 60s desde D-1
- [ ] Cert TLS válido por ≥ 30 dias (verificar com `openssl s_client`)
- [ ] Status page com banner "Manutenção programada" agendado para a janela

---

## 2. GO / NO-GO formal — 22:00 de D0

> Responder a cada pergunta com "SIM" ou "NÃO" antes de iniciar qualquer ação.

| Pergunta                                                         | Resposta | Responsável | Hora |
| ---------------------------------------------------------------- | -------- | ----------- | ---- |
| Smoke staging verde nas últimas 6h?                              |          |             |      |
| Todos os itens da seção 1 marcados?                              |          |             |      |
| Canal de incident ativo com todos os membros presentes?          |          |             |      |
| Feature flags `followup.*` e `billing.*` confirmados `disabled`? |          |             |      |
| Cofre de secrets prod acessível?                                 |          |             |      |

**Decisão GO/NO-GO:** **_  
**Assinado por (CTO):** Rogério Viana — Hora: _**

---

## 3. Execução do cutover (D0)

> Horário de referência: Hora de Brasília (BRT, UTC-3).
> Preencher "Feito às" e "Resp." em cada passo. Não pular passos.

### Fase 1 — Preparação (22:00–22:30)

| Hora alvo | Passo                   | Ação                                                                  | Done when...                                       | Feito às | Resp.  |
| --------- | ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | -------- | ------ |
| 22:00     | Congelar Notion         | Setar todos usuários Notion como read-only                            | Nenhum campo editável na UI                        | \_\_\_   | \_\_\_ |
| 22:05     | Confirmar plantão       | Check no canal de incident: todos presentes                           | "presente" de cada membro                          | \_\_\_   | \_\_\_ |
| 22:10     | Validar env prod        | `docker compose run --rm api node -e "require('./dist/lib/env').env"` | Sem erro de Zod — vars parseadas                   | \_\_\_   | \_\_\_ |
| 22:15     | Snapshot final Notion   | Rodar script export Notion (F7-S07)                                   | Arquivo `.zip` gerado, tamanho > snapshot anterior | \_\_\_   | \_\_\_ |
| 22:20     | Status page             | Ativar banner "Manutenção programada em andamento"                    | Banner visível na página de status                 | \_\_\_   | \_\_\_ |
| 22:25     | Desligar webhook antigo | Remover webhook WhatsApp/Chatwoot do sistema antigo                   | Nenhuma mensagem nova entra no sistema antigo      | \_\_\_   | \_\_\_ |

### Fase 2 — Migrations e importação (22:30–23:45)

| Hora alvo | Passo                   | Ação                                                        | Done when...                                             | Feito às | Resp.  |
| --------- | ----------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | -------- | ------ |
| 22:30     | Drift check pre-deploy  | `pnpm --filter @elemento/api db:check-drift`                | Exit code 0                                              | \_\_\_   | \_\_\_ |
| 22:35     | Migrations prod         | `pnpm --filter @elemento/api db:migrate`                    | Saída sem erro — todas pending aplicadas ou "No pending" | \_\_\_   | \_\_\_ |
| 22:40     | Drift check pós-migrate | `pnpm --filter @elemento/api db:check-drift`                | Exit code 0 — se ≠ 0, acionar rollback imediatamente     | \_\_\_   | \_\_\_ |
| 22:45     | Importação Notion prod  | `pnpm --filter @elemento/api import:notion -- --env prod`   | Batch concluído sem erro. `batch_id`: \_\_\_             | \_\_\_   | \_\_\_ |
| 23:15     | Importação análises CSV | `pnpm --filter @elemento/api import:analyses -- --env prod` | Batch concluído sem erro. `batch_id`: \_\_\_             | \_\_\_   | \_\_\_ |
| 23:30     | Validar contagem        | `SELECT COUNT(*) FROM leads` vs contagem Notion             | Delta ≤ 1% (ou aceitar explicitamente com nota)          | \_\_\_   | \_\_\_ |

> Contagem Notion esperada: **_ | Contagem Elemento pós-import: _** | Delta: **_% | Aceito? _**

### Fase 3 — Virada e smoke (23:45–01:00)

| Hora alvo | Passo                    | Ação                                                                            | Done when...                                                | Feito às | Resp.   |
| --------- | ------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ------- |
| 23:45     | Apontar webhook Meta     | Atualizar URL no Meta Business Manager para `<API_PROD>/webhooks/meta/whatsapp` | Mensagem de teste recebida em `whatsapp_messages`           | \_\_\_   | \_\_\_  |
| 23:50     | Apontar webhook Chatwoot | Atualizar URL nas configurações de webhook Chatwoot para Elemento prod          | Evento test recebido e processado                           | \_\_\_   | \_\_\_  |
| 00:00     | Smoke pós-deploy         | `./scripts/smoke-prod.ps1 -BaseUrl <URL> -AdminToken $env:PROD_ADMIN_TOKEN`     | Exit code **0** — se exit 2, acionar rollback imediatamente | \_\_\_   | \_\_\_  |
| 00:15     | Teste de fluxo real      | Enviar mensagem de teste pelo número QA                                         | Resposta IA recebida < 15s; lead aparece no Kanban          | \_\_\_   | \_\_\_  |
| 00:30     | Comunicar agentes        | Mensagem no grupo de operações: "Elemento ativo em produção"                    | ≥ 1 agente confirma acesso ao Manager                       | \_\_\_   | \_\_\_  |
| 00:45     | Status page              | Remover banner de manutenção — postar "Operacional"                             | Status page verde                                           | \_\_\_   | \_\_\_  |
| 01:00     | Plantão ativo            | Monitorar dashboards, métricas, alertas — entrar em modo de plantão             | —                                                           | \_\_\_   | Rogério |

---

## 4. Critério de rollback automático

> Se qualquer condição abaixo for detectada durante o cutover, **executar rollback imediatamente** sem esperar aprovação.

| Gatilho                       | Limiar                    | Ação                      |
| ----------------------------- | ------------------------- | ------------------------- |
| Smoke `exit code 2`           | qualquer                  | Rollback imediato         |
| Taxa de erro 5xx da API       | > 5% por 5 min contínuos  | Rollback                  |
| Latência p95 LangGraph        | > 8s por 10 min contínuos | Rollback                  |
| Outbox lag                    | > 15 min                  | Rollback                  |
| Falha de envio template Meta  | > 20 em 1h                | Rollback                  |
| Drift check pós-migrate falha | exit code ≠ 0             | Rollback — não prosseguir |

### Passos de rollback (RTO objetivo: ≤ 30 min)

| Min | Passo                     | Ação                                                                           |
| --- | ------------------------- | ------------------------------------------------------------------------------ |
| +0  | Acionar canal de incident | "ROLLBACK INICIADO — [motivo] — todos em standby"                              |
| +2  | Reverter DNS              | Apontar de volta para sistema antigo (TTL 60s desde D-1)                       |
| +5  | Desligar webhook Meta     | Remover URL Elemento no Meta Business Manager                                  |
| +7  | Desligar webhook Chatwoot | Remover URL Elemento nas configurações Chatwoot                                |
| +10 | Parar containers          | `docker compose stop api langgraph workers`                                    |
| +12 | Reativar escritas Notion  | Restaurar permissões de edição para usuários                                   |
| +15 | Anunciar reversão         | Mensagem para agentes: "Sistema anterior restaurado. Usar Notion normalmente." |
| +20 | Validar sistema antigo    | Enviar mensagem de teste → confirmar resposta via sistema antigo               |
| +30 | Iniciar post-mortem       | Abrir `F7-S09-postmortem.md` e registrar rollback como "incidente D0"          |

> Rollback executado? [ ] Sim / [ ] Não  
> Se sim: hora início **_ | hora conclusão _** | RTO real **_ min | próxima janela: _**

---

## 5. Operação paralela (D0+1 → D0+7)

### 5.1 Regras

- **Notion:** somente leitura após D0. Proibido criar ou editar leads/análises.
- **Elemento:** sistema primário para todos os novos atendimentos.
- **Plantão:** Rogério on-call 24/7, secundário designado, SLA P1 ≤ 15 min.

### 5.2 Rotina diária (9h — D0+1 a D0+7)

1. Stand-up com cliente (15 min): incidentes últimas 24h, métricas do dia anterior
2. Rodar diff script: `.\scripts\diff-import-vs-source.ps1 -NotionBackup .\notion-snapshot-$(Get-Date -Format 'yyyyMMdd').json -AnalysesCsv .\analyses-$(Get-Date -Format 'yyyyMMdd').csv -StagingDbUrl $env:PROD_DATABASE_URL -OutputCsv .\reports\parallel-diff-$(Get-Date -Format 'yyyyMMdd').csv`
3. Verificar alertas pendentes — resolver ou escalar P1/P2 antes do fim do stand-up
4. Atualizar log de operação paralela abaixo

### 5.3 Log de operação paralela

| Data | Leads Elemento | Leads Notion | Delta | Incidentes | Smoke | Status |
| ---- | -------------- | ------------ | ----- | ---------- | ----- | ------ |
| D+1  |                |              |       |            |       |        |
| D+2  |                |              |       |            |       |        |
| D+3  |                |              |       |            |       |        |
| D+4  |                |              |       |            |       |        |
| D+5  |                |              |       |            |       |        |
| D+6  |                |              |       |            |       |        |
| D+7  |                |              |       |            |       |        |

### 5.4 Métricas a monitorar (dashboard `/dashboard/metrics` + logs)

| Métrica                | Alerta P1                | Alerta P2         | Observado D+1 | Observado D+7 |
| ---------------------- | ------------------------ | ----------------- | ------------- | ------------- |
| Taxa de erro 5xx       | > 5% / 5 min             | —                 |               |               |
| Latência p95 API       | —                        | > 2000ms / 10 min |               |               |
| Latência p95 LangGraph | —                        | > 5000ms / 10 min |               |               |
| Outbox lag             | > 600s                   | —                 |               |               |
| Outbox falhas          | > 10/min                 | —                 |               |               |
| Webhook WA recebidos   | queda > 50% vs 24h média | —                 |               |               |
| Custo LLM (USD)        | > `LLM_DAILY_BUDGET_USD` | > 80% do budget   |               |               |
| Handoffs IA → humano   | spike > 20/h vs. média   | —                 |               |               |

---

## 6. Sign-off de operação estável (D0+7)

> Todos os critérios abaixo devem ser verdadeiros para declarar operação estável.

### 6.1 Critérios técnicos

- [ ] Sem incidente P1 nas últimas 72h
- [ ] Sem incidente P2 aberto sem resolução
- [ ] Taxa de erro 5xx < 1% nas últimas 48h
- [ ] Latência p95 < 3s nas últimas 48h
- [ ] Contagem de leads Elemento ≥ contagem Notion (delta ≤ 1%)

### 6.2 Critérios processuais

- [ ] Cliente confirma operação estável por escrito (e-mail ou canal de incident)
- [ ] Aprovação formal do CTO

> Assinatura cliente (nome + cargo): ************\_\_\_************  
> Data/hora da confirmação: ************\_\_\_************  
> Aprovação CTO (Rogério): ************\_\_\_************ | Data: \_\_\_

---

## 7. Decommissioning (D0+8 → D0+30)

Após sign-off de operação estável:

- [ ] Exportar snapshot final Notion (`.zip` markdown + CSV) — arquivar no cofre por 12 meses
- [ ] Setar todos os usuários Notion como read-only permanente (sem mais edição)
- [ ] Arquivar workspace Notion (não deletar — histórico preservado)
- [ ] Desativar integrações Notion (API key, webhooks se existirem)
- [ ] Comunicar ao cliente por escrito: "Notion arquivado — Elemento é o sistema único"
- [ ] Registrar plano de habilitação progressiva de feature flags:
  - Onda 2 — `followup.enabled`: slot **_-_** (abrir após sign-off)
  - Onda 3 — `billing.enabled`: slot **_-_** (abrir após onda 2 estável)
- [ ] Pós-mortem da semana 1 registrado em `F7-S09-postmortem.md`
- [ ] Slots novos abertos para itens emergidos (links no postmortem)
- [ ] Acessos Rogério/Elemento ao cofre do cliente revogados (offboarding) em ≤ 24h após D0+30

---

## 8. Referências rápidas

### Comandos de diagnóstico

```bash
# Logs imediatos
docker logs api --tail 100 -f
docker logs langgraph --tail 100 -f
docker logs workers --tail 100 -f

# Healthchecks
curl -s https://<API_URL>/health | jq .
curl -s https://<LANGGRAPH_URL>/health | jq .

# Queries lentas em Postgres
psql $DATABASE_URL -c "
  SELECT pid, now() - query_start AS duration, left(query, 100)
  FROM pg_stat_activity
  WHERE now() - query_start > interval '5 seconds' AND state != 'idle'
  ORDER BY duration DESC;"

# Outbox lag
psql $DATABASE_URL -c "
  SELECT COUNT(*) AS pending,
         MIN(created_at) AS oldest,
         EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) AS lag_seconds
  FROM event_outbox WHERE processed_at IS NULL;"

# Feature flags
curl -s https://<API_URL>/api/feature-flags -H "Authorization: Bearer $TOKEN" | jq .

# Smoke prod
./scripts/smoke-prod.ps1 -BaseUrl https://<API_URL> -AdminToken $env:PROD_ADMIN_TOKEN
```

### Escalonamento rápido

```
P1 (≤ 15 min de resposta):
  → On-call secundário: [contato]
  → Rogério (primário): rogerio5566.ro@gmail.com / WhatsApp: [número]
  → DPO (se PII envolvido): [contato]

P2 (≤ 1h):
  → Canal de incident: [link]

OpenRouter: support@openrouter.ai
Meta Business: Meta Business Help Center
```

### Template de declaração de incidente

```
INCIDENTE DECLARADO
Tipo: [LangGraph down / Postgres lento / etc]
Hora de início: [HH:MM]
Impacto: [X usuários afetados / etc]
Responsável: [nome]
Status: investigando
Próximo update: [HH:MM]
```

### Template de rollback

```
ROLLBACK ELEMENTO
Hora: [HH:MM]
Motivo: [descrição objetiva]
Status do sistema antigo: [OK / verificando]
Próximo update: [HH:MM]
Responsável: [nome]
```
