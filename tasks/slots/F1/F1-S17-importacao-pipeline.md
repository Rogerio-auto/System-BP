---
id: F1-S17
title: Pipeline de importação genérico (com adapter de leads)
phase: F1
task_ref: T1.17
status: review
priority: high
estimated_size: L
agent_id: claude-code
claimed_at: 2026-05-12T16:45:47Z
completed_at: 2026-05-12T17:43:33Z
pr_url: null
depends_on: [F1-S11, F1-S15]
blocks: [F1-S18]
source_docs:
  - docs/08-importacoes.md
  - docs/12-tasks-tecnicas.md#T1.17
---

# F1-S17 — Pipeline de importação

## Objetivo

Pipeline genérico CSV/XLSX com 4 fases: upload → parse → validate → preview → confirm → process. Cobertura para `leads`. Worker dedicado.

## Escopo

- Schemas: `import_batches`, `import_rows`.
- Endpoints `POST /api/imports/leads` (upload), `GET /api/imports/:id/preview`, `POST /api/imports/:id/confirm`.
- Worker `import-processor`.
- Adapter pattern: `interface ImportAdapter<T>` com `parseRow`, `validateRow`, `persistRow`.
- Adapter `leadsAdapter`.
- Feature flag `crm.import.enabled`.
- Limite de tamanho, MIME validation.

## Definition of Done

- [ ] Importar 100 leads CSV ponta a ponta
- [ ] Preview mostra válidas/inválidas com erros claros
- [ ] Idempotência por hash do arquivo
- [ ] Flag desligada bloqueia rota e UI
- [ ] PR aberto
