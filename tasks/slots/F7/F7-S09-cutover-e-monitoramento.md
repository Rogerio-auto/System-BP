---
id: F7-S09
title: Cutover, go-live e monitoramento das primeiras 168h
phase: F7
task_ref: T7.9
status: in-progress
priority: critical
estimated_size: L
agent_id: backend-engineer
claimed_at: 2026-05-29T19:41:02Z
completed_at: null
pr_url: null
depends_on: [F7-S01, F7-S02, F7-S03, F7-S06, F7-S07, F7-S08]
blocks: []
labels: []
source_docs:
  - docs/11-roadmap-executavel.md
  - docs/13-criterios-aceite.md
  - docs/19-runbook-go-live.md
  - docs/14-riscos-mitigacoes.md
---

# F7-S09 — Cutover, go-live e monitoramento 168h

## Objetivo

Executar o cutover documentado no doc 19, ligar 100% do tráfego WhatsApp para o Elemento, manter Notion como read-only por 7 dias (168h) com monitoramento ativo, e formalizar o decommissioning.

## Escopo

- **D0 — Cutover** (seguir doc 19 §6):
  - Janela acordada com cliente (sugestão: madrugada de sábado para domingo)
  - Backup final Notion
  - Migrations finais (já rodadas em staging)
  - Apontar webhook WhatsApp/Chatwoot para Elemento prod
  - Smoke E2E pós-deploy (script F7-S06 `smoke-prod.ps1`)
  - Comunicar agentes que o novo sistema está ativo
- **D0+1 a D0+7 — Operação paralela com monitoramento ativo**:
  - Notion em modo read-only (sem novos registros, mantém histórico)
  - Daily standup com cliente (15 min) para reportar incidentes
  - Dashboard de health 24/7 (métricas de F7-S06)
  - Alertas configurados (provedor a definir)
  - Plantão técnico designado (Rogério + dev secundário)
  - SLA de resposta: P1 ≤ 15 min, P2 ≤ 1h, P3 ≤ 4h
- **D0+7 — Sign-off de operação estável**:
  - Critério: sem P1 nas últimas 72h, sem P2 não-resolvido, taxa de erro <1%, latência p95 <3s
  - Reunião com cliente para confirmar aceitação
  - Documento de "operação estável" assinado
- **D0+8 a D0+30 — Decommissioning**:
  - Notion arquivado (sem deleção — backup retido por 12 meses)
  - Plano de habilitação progressiva de feature flags (followup → billing) registrado
  - Pós-mortem de incidentes da semana 1 documentado
- **Relatório final** em `tasks/slots/F7/F7-S09-postmortem.md` (sub-arquivo):
  - O que rolou bem
  - O que rolou mal
  - Métricas dos 7 dias (volumes, latências, erros, handoffs)
  - Ajustes feitos em runtime (e por que)
  - Próximos passos (slots novos abertos pós-launch)

## Fora de escopo

- Habilitar feature flags `followup.enabled` / `billing.enabled` (slot dedicado pós-sign-off com cliente)
- Implementar provedor de logs/métricas final (slot futuro de infra; nesta fase usa o mínimo)
- Migração de dados de operação (n8n, planilhas auxiliares) — slots posteriores se necessário

## Arquivos permitidos

```
tasks/slots/F7/F7-S09-runbook-execucao.md
tasks/slots/F7/F7-S09-postmortem.md
tasks/slots/F7/F7-S09-incidentes/
docs/19-runbook-go-live.md
```

## Definition of Done

- [ ] Cutover executado conforme runbook
- [ ] Smoke pós-deploy verde
- [ ] Operação paralela 7 dias sem P1 não-resolvido
- [ ] Sign-off de operação estável assinado pelo cliente
- [ ] Notion arquivado (não deletado)
- [ ] Pós-mortem registrado em `F7-S09-postmortem.md`
- [ ] Slots novos abertos para itens emergidos (links no postmortem)

## Validação

```powershell
# Smoke pós-deploy
./scripts/smoke-prod.ps1 -BaseUrl https://elemento.prod.url -AdminToken $env:PROD_ADMIN_TOKEN

# Health-check operacional
curl https://elemento.prod.url/health
curl https://langgraph.elemento.prod.url/health
```
