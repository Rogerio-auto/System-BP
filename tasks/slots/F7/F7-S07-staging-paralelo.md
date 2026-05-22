---
id: F7-S07
title: Importação em staging + conferência paralela com Notion
phase: F7
task_ref: T7.7
status: available
priority: high
estimated_size: M
agent_id: qa-tester
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F4-S06, F7-S04, F7-S06]
blocks: [F7-S09]
labels: []
source_docs:
  - docs/08-importacoes.md
  - docs/13-criterios-aceite.md
  - docs/19-runbook-go-live.md
---

# F7-S07 — Importação em staging + conferência paralela

## Objetivo

Rodar a importação completa de Notion + análises em ambiente de staging, conferir com os gestores do Banco do Povo, e gerar relatório de aceitação assinado antes do cutover.

> **Nota:** importação de Trello foi descartada do escopo em 2026-05-22 (decisão do CTO — base atual já cabe inteira em Notion + planilhas). O Kanban interno é populado a partir da importação Notion + criação manual.

## Escopo

- Procedimento documentado em `tasks/slots/F7/F7-S07-runbook.md` (sub-arquivo) com passos cronológicos:
  1. Snapshot Notion (timestamp de referência)
  2. Subir staging com `.env` apontando para infra de staging do cliente
  3. Rodar migrations + seed
  4. Importar Notion (F7-S04) — registrar batch_id, contadores
  5. Importar análises CSV (F4-S06) — registrar batch_id, contadores
  6. Rodar relatório de conferência (`scripts/diff-import-vs-source.ps1`):
     - Para cada lead em Notion: existe em staging? mesmo nome/telefone/cidade?
     - Para cada análise CSV: credit_analysis existe?
     - Saída: CSV com `id_fonte`, `id_destino`, `status` (ok/missing/divergence), `divergence_fields`
  7. Sessão com gestor: revisar divergências, decidir (corrigir adapter / aceitar / postergar)
  8. Documento final de aceitação assinado (PDF anexado ao PR)
- Script `scripts/diff-import-vs-source.ps1`:
  - Recebe `-NotionBackup`, `-AnalysesCsv`, `-StagingDbUrl`
  - Executa diffs em lote
  - Emite CSV de divergências
- Atualizar `docs/19-runbook-go-live.md` (slot F7-S06) §5 com referência a este procedimento

## Fora de escopo

- Cutover em produção (F7-S09)
- Correção de adapter para casos edge — abrir slot novo se aparecer

## Arquivos permitidos

```
tasks/slots/F7/F7-S07-runbook.md
scripts/diff-import-vs-source.ps1
scripts/__tests__/diff-import-vs-source.test.ps1
docs/19-runbook-go-live.md
```

## Definition of Done

- [ ] Procedimento documentado e exercitado em staging
- [ ] Script de diff funciona com fixtures reduzidas (testes)
- [ ] Relatório de conferência gerado com 100% dos itens (sem erro fatal)
- [ ] Sessão com gestor realizada — ata anexada ao PR
- [ ] Documento de aceitação assinado anexo

## Validação

```powershell
test-path scripts/diff-import-vs-source.ps1
./scripts/diff-import-vs-source.ps1 -NotionBackup test-fixtures/notion.json -AnalysesCsv test-fixtures/analyses.csv -StagingDbUrl $env:STAGING_DATABASE_URL
```
