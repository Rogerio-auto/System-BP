---
id: F4-S06
title: Adapter de importação de análises de crédito
phase: F4
task_ref: T4.6
status: done
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-25T16:34:19Z
completed_at: 2026-05-25T16:52:50Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/150
depends_on: [F4-S02, F1-S17, F1-S18]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/08-importacoes.md
  - docs/17-lgpd-protecao-dados.md
---

# F4-S06 — Adapter de importação de análises de crédito

## Objetivo

Aproveitar o pipeline genérico de importação (F1-S17) com um adapter que normaliza planilhas históricas de análise de crédito (Notion/Excel exportados) para o schema `credit_analyses`/`credit_analysis_versions`. Sem este slot, a migração da base existente do Banco do Povo precisaria de SQL manual.

## Escopo

- `apps/api/src/services/imports/adapters/analysesAdapter.ts`:
  - Implementa o contrato `ImportAdapter` do registry
  - Mapeia colunas conhecidas:
    | Coluna fonte (variantes) | Campo destino | Notas |
    | --- | --- | --- |
    | `lead_id`, `id_lead`, `lead` | lookup → `lead_id` | resolve por `id` ou `primary_phone` |
    | `status`, `situacao` | `status` | normaliza para enum (case-insensitive, sem acento) |
    | `parecer`, `observacao`, `parecer_text` | `parecer_text` v1 | regex CPF/RG bloqueia row |
    | `valor_aprovado`, `aprovado_valor` | `approved_amount` | parse BR currency (R$ 1.234,56) |
    | `prazo_meses`, `prazo` | `approved_term_months` | int |
    | `taxa_mensal`, `taxa` | `approved_rate_monthly` | parse percentual (2,5% → 0.025) |
    | `analista`, `usuario` | `analyst_user_id` | lookup por email/full_name |
    | `data_decisao` | `created_at` v1 | iso ou dd/mm/aaaa |
  - `origin='import'` sempre
  - Cria 1 versão por row (não atualiza análise existente do mesmo lead — se já existe, marca row como `duplicate`)
- Registrar no registry `apps/api/src/services/imports/registry.ts` como `kind: 'analyses'`
- Frontend: wizard de importação (F1-S18) já suporta novos kinds — adicionar opção "Análises de crédito" no select
- Testes de adapter com 4 fixtures CSV (linha válida, linha com CPF rejeitada, lead inexistente, status inválido)

## LGPD

- Importação registra `audit_logs` com `actor_kind='user'`, `action='import_credit_analyses'`, `batch_id`
- `pareceres` que falham regex CPF/RG **não** entram no banco; row vai para `import_errors` com `field=parecer_text`, `code=PII_BRUTA_DETECTADA`
- `attachments` não são importados em massa (só metadados são suportados; arquivo físico é slot futuro)
- Documentação do operador: o arquivo CSV original **NÃO** deve ser logado, apenas seu hash + nome em `import_batches.source_filename`

## Fora de escopo

- Migração de Notion API (slot F7-S04)
- Importação de anexos físicos

## Arquivos permitidos

```
apps/api/src/services/imports/adapters/analysesAdapter.ts
apps/api/src/services/imports/registry.ts
apps/api/src/services/imports/__tests__/analysesAdapter.test.ts
apps/api/src/services/imports/__tests__/fixtures/analyses-valid.csv
apps/api/src/services/imports/__tests__/fixtures/analyses-cpf-rejected.csv
apps/api/src/services/imports/__tests__/fixtures/analyses-lead-not-found.csv
apps/web/src/features/imports/constants.ts
```

## Definition of Done

- [ ] Adapter implementa `ImportAdapter` interface completa (validate, normalize, persist)
- [ ] 4 fixtures cobertas + testes verdes
- [ ] Regex CPF/RG bloqueia row com mensagem clara
- [ ] Parse BR currency e percentual funcionam (testes com casos extremos)
- [ ] `origin='import'` setado em todos os inserts
- [ ] Frontend wizard mostra "Análises de crédito" no select de kind
- [ ] Audit log emitido por batch (`import_credit_analyses`)
- [ ] PR com label `lgpd-impact` + checklist doc 17

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- analysesAdapter
pnpm --filter @elemento/web typecheck
```
