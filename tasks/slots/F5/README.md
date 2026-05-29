# Fase 5 — Automações (gated por flag)

> Slots materializados em 2026-05-22. Origem: [docs/11-roadmap-executavel.md §Fase 5](../../../docs/11-roadmap-executavel.md), [docs/03-modelo-dados.md §8](../../../docs/03-modelo-dados.md).
>
> **Política:** schemas + workers entram em produção **com flags em `disabled`** desde o dia 1. Habilitação progressiva pós sign-off da semana 1 (primeiro `followup.enabled`, depois `billing.enabled`, com janelas de observação ≥ 7 dias entre cada).

## Follow-up de leads

| ID                                            | Título                                                     | Prioridade | Tamanho | Depende de                                     |
| --------------------------------------------- | ---------------------------------------------------------- | ---------- | ------- | ---------------------------------------------- |
| [F5-S01](F5-S01-schema-followup.md)           | Schema followup_rules + followup_jobs + whatsapp_templates | high       | M       | F0-S04, F1-S09, F1-S15, F1-S23                 |
| [F5-S02](F5-S02-worker-followup-scheduler.md) | Worker followup-scheduler (gated)                          | high       | M       | F5-S01, F1-S15, F1-S23                         |
| [F5-S03](F5-S03-worker-followup-sender.md)    | Worker followup-sender + cliente Meta templates            | high       | L       | F5-S01, F5-S02, F1-S15, F1-S20                 |
| [F5-S04](F5-S04-followup-cancel-on-reply.md)  | Cancelamento de followup por resposta do cliente           | high       | S       | F5-S01, F5-S03, F1-S19, F1-S15                 |
| [F5-S05](F5-S05-frontend-followup.md)         | Frontend réguas + jobs + pausa manual                      | medium     | L       | F5-S01, F5-S02, F5-S03, F1-S08, F1-S23, F8-S08 |

## Cobrança / régua de inadimplência

| ID                                      | Título                                                        | Prioridade | Tamanho | Depende de                             |
| --------------------------------------- | ------------------------------------------------------------- | ---------- | ------- | -------------------------------------- |
| [F5-S06](F5-S06-schema-collection.md)   | Schema payment_dues + collection_rules + collection_jobs      | medium     | M       | F5-S01, F1-S09, F1-S15, F1-S23, F1-S24 |
| [F5-S07](F5-S07-workers-collection.md)  | Workers collection-scheduler + collection-sender (gated)      | medium     | M       | F5-S06, F5-S03, F1-S15                 |
| [F5-S08](F5-S08-frontend-collection.md) | Frontend cobrança + importação payment_dues + marcação manual | medium     | L       | F5-S06, F5-S07, F1-S08, F1-S17, F8-S08 |

## Templates WhatsApp Meta

| ID                                          | Título                                                            | Prioridade | Tamanho | Depende de                             |
| ------------------------------------------- | ----------------------------------------------------------------- | ---------- | ------- | -------------------------------------- |
| [F5-S09](F5-S09-frontend-templates-meta.md) | Frontend templates WhatsApp + sync Meta Cloud + webhook de status | medium     | L       | F5-S01, F5-S03, F1-S08, F1-S20, F8-S08 |

### Ordem sugerida

1. **B0:** F5-S01 (schema followup — bloqueia 2–5, 9)
2. **B1:** F5-S02 → F5-S03 → F5-S04 sequencial (encadeamento da régua)
3. **B2 (paralelo após B1):** F5-S05 (UI followup) + F5-S06 (schema cobrança) + F5-S09 (UI templates Meta)
4. **B3:** F5-S07 → F5-S08 (cobrança completa)
