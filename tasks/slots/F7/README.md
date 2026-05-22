# Fase 7 — Migração + go-live

> Slots materializados em 2026-05-22 (auditoria pré-launch). Origem: [docs/11-roadmap-executavel.md §Fase 7](../../../docs/11-roadmap-executavel.md), [docs/19-runbook-go-live.md](../../../docs/19-runbook-go-live.md).
>
> **F7 é o caminho crítico para produção.** F7-S01, F7-S02 e F7-S03 são bloqueadores absolutos identificados na auditoria — sem eles, não há go-live.

## Bloqueadores absolutos (resolvem ANTES de qualquer deploy em prod)

| ID                                        | Título                                                                   | Prioridade | Tamanho | Depende de             |
| ----------------------------------------- | ------------------------------------------------------------------------ | ---------- | ------- | ---------------------- |
| [F7-S01](F7-S01-kimi-k2-default-model.md) | Configurar Kimi K2 como modelo default do reasoner                       | critical   | S       | F3-S00, F9-S00         |
| [F7-S02](F7-S02-ci-e2e-smoke.md)          | CI — E2E smoke test (docker-compose + fluxo crítico)                     | critical   | M       | F3-S33, F3-S34         |
| [F7-S03](F7-S03-hardening-f3-pre-prod.md) | Hardening F3 pré-produção (timing-safe, multi-tenant, idempotency, logs) | critical   | L       | F3-S33, F3-S34, F9-S10 |

## Migração de dados

> Adapter Trello (F7-S05) foi descartado em 2026-05-22 (decisão do CTO). Migração de operação fica restrita ao Notion + planilhas de análises.

| ID                                        | Título                                | Prioridade | Tamanho | Depende de             |
| ----------------------------------------- | ------------------------------------- | ---------- | ------- | ---------------------- |
| [F7-S04](F7-S04-import-notion-adapter.md) | Adapter Notion → leads + lead_history | high       | L       | F1-S17, F1-S18, F1-S24 |

## Cutover, treinamento, monitoramento

| ID                                          | Título                                                  | Prioridade | Tamanho | Depende de                                     |
| ------------------------------------------- | ------------------------------------------------------- | ---------- | ------- | ---------------------------------------------- |
| [F7-S06](F7-S06-runbook-go-live.md)         | Runbook de go-live + observabilidade pré-prod           | high       | M       | F7-S01, F7-S02, F7-S03                         |
| [F7-S07](F7-S07-staging-paralelo.md)        | Importação em staging + conferência paralela com Notion | high       | M       | F4-S06, F7-S04, F7-S06                         |
| [F7-S08](F7-S08-treinamento.md)             | Treinamento dos agentes + material                      | medium     | M       | F7-S06                                         |
| [F7-S09](F7-S09-cutover-e-monitoramento.md) | Cutover, go-live e monitoramento 168h                   | critical   | L       | F7-S01, F7-S02, F7-S03, F7-S06, F7-S07, F7-S08 |

### Caminho crítico

```
F7-S01 (Kimi K2)
   ↓
F4-S01 → F4-S02 (análise persiste)
   ↓
F7-S03 (hardening) ┐
F7-S02 (CI E2E)    ┼─→ F7-S06 (runbook)
                   ┘        ↓
F7-S04 (Notion) ──────→ F7-S07 (staging) → F7-S08 (treino) → F7-S09 (cutover)
```

Estimativa para go-live com 1 dev sênior em foco total: **3-4 semanas**.
