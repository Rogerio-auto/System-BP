# Fase 4 — Análise de crédito

> Slots materializados em 2026-05-22 (auditoria pré-launch). Origem: [docs/11-roadmap-executavel.md §Fase 4](../../../docs/11-roadmap-executavel.md), [docs/12-tasks-tecnicas.md](../../../docs/12-tasks-tecnicas.md) T4.1–T4.6, [docs/17-lgpd-protecao-dados.md §13 (Art. 20)](../../../docs/17-lgpd-protecao-dados.md).

Bloqueador de go-live: **F4-S01 + F4-S02** materializam a persistência da análise (Art. 20 §1º LGPD — registro auditável da decisão).

| ID                                                   | Título                                                           | Prioridade | Tamanho | Depende de                             |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ------- | -------------------------------------- |
| [F4-S01](F4-S01-schema-credit-analyses.md)           | Schema credit_analyses + credit_analysis_versions + migration    | critical   | M       | F2-S01, F1-S09, F1-S13, F1-S15, F1-S24 |
| [F4-S02](F4-S02-backend-credit-analyses-api.md)      | Backend service + endpoints CRUD (RBAC + Art. 20)                | critical   | L       | F4-S01, F1-S04, F1-S15, F1-S16         |
| [F4-S03](F4-S03-frontend-credit-analyses.md)         | Frontend lista + detalhe + form + nova versão                    | high       | L       | F4-S02, F1-S08, F1-S12, F8-S08         |
| [F4-S04](F4-S04-tool-get-credit-analysis-history.md) | Tool LangGraph get_credit_analysis_history (read-only mascarado) | high       | M       | F4-S02, F3-S04, F1-S26                 |
| [F4-S05](F4-S05-worker-kanban-on-analysis.md)        | Worker kanban-on-analysis (aprova/recusa move card)              | high       | S       | F4-S02, F1-S13, F1-S15, F2-S09         |
| [F4-S06](F4-S06-import-analyses-adapter.md)          | Adapter de importação de análises (CSV)                          | medium     | M       | F4-S02, F1-S17, F1-S18                 |

### Ordem sugerida

1. **B0:** F4-S01 (schema sozinho — bloqueia todos)
2. **B1 (paralelo):** F4-S02 (backend)
3. **B2 (paralelo, arquivos disjuntos):** F4-S03 (frontend) + F4-S04 (tool LangGraph) + F4-S05 (worker) + F4-S06 (adapter import)
