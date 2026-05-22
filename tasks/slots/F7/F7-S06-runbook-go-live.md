---
id: F7-S06
title: Runbook de go-live + observabilidade pré-prod
phase: F7
task_ref: T7.6
status: available
priority: high
estimated_size: M
agent_id: backend-engineer
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F7-S01, F7-S02, F7-S03]
blocks: [F7-S09]
labels: []
source_docs:
  - docs/02-arquitetura-sistema.md
  - docs/11-roadmap-executavel.md
  - docs/13-criterios-aceite.md
  - docs/14-riscos-mitigacoes.md
---

# F7-S06 — Runbook de go-live + observabilidade pré-prod

## Objetivo

Materializar o doc operacional que orienta o cutover: checklist pré-prod, observabilidade mínima (logs, métricas, alertas), procedimentos de smoke pós-deploy, rollback documentado. Sem este doc o go-live é improvisado.

## Escopo

- Criar `docs/19-runbook-go-live.md` com seções:
  1. **Pré-requisitos** — todos os bloqueadores resolvidos (F7-S01, F7-S02, F7-S03), DPIA aprovado, contrato com Banco do Povo assinado
  2. **Inventário de infra** — Postgres (host, versão, backups), API (host, env, replicas), LangGraph (host, env), Object storage (se aplicável), Chatwoot (host), Meta WhatsApp (BSP, phone_number_id)
  3. **Configuração de env por ambiente** — staging, prod (tabela de vars com origem do secret)
  4. **Secrets** — onde armazenados (1Password / Vault / KMS), rotação anual mínima, lista canônica
  5. **Checklist pré-cutover** (D-7 até D0)
     - [ ] Backup completo do Notion (export markdown + CSV)
     - [ ] DNS configurado + cert TLS válido (≥ 30 dias até expirar)
     - [ ] Migrations rodadas em staging com dados de produção (cópia anonimizada)
     - [ ] Smoke E2E (F7-S02) verde em staging
     - [ ] Feature flags revisadas — todas as flags pós-MVP em `disabled` (followup, billing)
     - [ ] LGPD: RoPA atualizado, DPIA aprovado, política de retenção configurada (jobs F1-S25)
     - [ ] Treinamento dos agentes humanos concluído (F7-S08)
     - [ ] Plano de rollback exercitado em staging (ver §7)
  6. **Procedimento de cutover (D0)** — passo a passo cronológico (preparação, congelamento, migração, validação, ativação)
  7. **Plano de rollback** — gatilhos (taxa de erro >X%, latência p95 >Y, perda de dados detectada), passos (reverter DNS, desligar webhook, parar workers, restaurar snapshot de DB), tempo objetivo de rollback (RTO)
  8. **Operação paralela (D0+1..D0+7)** — Notion read-only, comparação diária de leads entre sistemas, log de divergências, critério de "desativação total"
  9. **Smoke test pós-deploy** — script `scripts/smoke-prod.ps1` que faz: health-check API, health-check LangGraph, GET /api/dashboard/metrics como admin, POST de mensagem teste no número de QA
  10. **Observabilidade mínima**:
  - Logs centralizados (provedor a definir — sugere docker logs + ingestion futuro)
  - Métricas: `langgraph.requests_total`, `langgraph.latency_ms`, `langgraph.handoffs_total`, `outbox.lag_seconds`, `webhook.whatsapp.received`, `webhook.chatwoot.received`
  - Alertas mínimos: API down >2min, taxa de erro 5xx >5%, outbox lag >10min, falha de envio template Meta >10/h
  11. **Procedimentos de incidente** — playbook para 5 cenários (LangGraph down, Postgres slow, webhook duplicado, template Meta bloqueado, vazamento PII)
  12. **Contatos de plantão** — quem é o on-call inicial, escalação, SLA por severidade
- Atualizar `docs/00-visao-geral.md` adicionando referência ao doc 19 na lista de docs
- Adicionar entry em `docs/13-criterios-aceite.md` para "gates de go-live" (referencia checklist do §5 do doc 19)
- Script `scripts/smoke-prod.ps1`:
  - Recebe `-BaseUrl` e `-AdminToken`
  - Executa checks acima
  - Retorna exit code 0 (ok) / 1 (warn) / 2 (fail)

## Fora de escopo

- Implementação de provedor de logs/métricas (slot futuro de infra; doc 19 apenas especifica)
- Configuração de DNS/cert (responsabilidade do cliente)
- Treinamento dos agentes (F7-S08)

## Arquivos permitidos

```
docs/19-runbook-go-live.md
docs/00-visao-geral.md
docs/13-criterios-aceite.md
scripts/smoke-prod.ps1
scripts/__tests__/smoke-prod.test.ps1
```

## Definition of Done

- [ ] `docs/19-runbook-go-live.md` criado com as 12 seções
- [ ] Script `smoke-prod.ps1` executável + testado contra ambiente local
- [ ] Doc 00 atualizado com referência ao 19
- [ ] Doc 13 com seção "Gates de go-live"
- [ ] Plano de rollback exercitado em staging (registrar em log no PR)
- [ ] Revisão humana do Rogério antes de fechar

## Validação

```powershell
test-path docs/19-runbook-go-live.md
test-path scripts/smoke-prod.ps1
# Smoke local
./scripts/smoke-prod.ps1 -BaseUrl http://localhost:3333 -AdminToken $env:ADMIN_TOKEN
```
