---
id: F23-S09
title: Backend — exportação de relatórios (CSV/XLSX/PDF) com RBAC e audit
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: available
priority: medium
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F23-S04, F23-S05]
blocks: []
labels: [backend, reports, export, rbac, lgpd-impact]
source_docs:
  [
    docs/planejamento-relatorios-metricas.md,
    docs/17-lgpd-protecao-dados.md,
    docs/09-feature-flags.md,
  ]
docs_required: false
---

# F23-S09 — Backend: exportação de relatórios

## Objetivo

Endpoint de exportação que gera CSV, XLSX e PDF **server-side**, com o mesmo escopo/RBAC dos
endpoints de leitura, gating por `reports:export` + flag `reports.export.enabled`, e auditoria
da exportação. Apenas agregados (LGPD).

## Contexto

Plano §6. Permissão `reports:export` criada em F23-S02; flag `reports.export.enabled` já existe
no catálogo. **⚠️ Usar `exceljs` para XLSX — NÃO `xlsx`/SheetJS** (CVE de prototype pollution já
levantada na auditoria de 2026-06-22). CSV gerado manualmente (sem dep). PDF via `pdfkit`
(decisão D4 default). Nova dependência exige justificativa no PR (PROTOCOL §1.3).

## Escopo (faz)

- `POST /api/reports/export` `{ section, format, filters }` → arquivo (stream/attachment).
  Reaplica RBAC + `applyCityScope` + self-scope (NUNCA confiar no front); a query de export é a
  mesma da tela com os mesmos filtros.
- Gating duplo: permissão `reports:export` + flag `reports.export.enabled` (4 camadas — aqui a camada API).
- Geradores: CSV (manual), XLSX (`exceljs`, abas por seção quando "relatório completo"), PDF
  (`pdfkit`, com cabeçalho Banco do Povo/SEDEC). Limite de linhas no MVP (síncrono); acima do
  limite → erro claro orientando refinar filtros (assíncrono fica para depois).
- Auditoria `action: 'reports.export'` com formato, seção, filtros e contagem de linhas (**sem PII bruta**).
- Schema Zod de request em `packages/shared-schemas`.

## Fora de escopo (NÃO faz)

- UI de exportação (F23-S10).
- Geração assíncrona/job + storage (futuro).
- Export com PII/drill-down de pessoas (proibido neste slot — só agregados).

## Arquivos permitidos

- `packages/shared-schemas/src/reports.ts`
- `apps/api/src/modules/reports/export/`
- `apps/api/src/modules/reports/routes.ts`
- `apps/api/src/modules/reports/controller.ts`
- `apps/api/src/modules/reports/__tests__/reports-export.test.ts`
- `apps/api/package.json`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/modules/dashboard/**`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- `POST /api/reports/export` gera CSV/XLSX/PDF com os mesmos dados/escopo da tela.
- Gating por `reports:export` + flag; sem permissão/flag → 403/feature-off.
- Export contém só agregados; nenhum CPF/telefone/nome de cidadão.
- Exportação auditada sem PII bruta.
- XLSX via `exceljs` (não `xlsx`); dependência justificada no PR.

## Definition of Done

- [ ] `POST /api/reports/export` com RBAC + scope + self-scope reaplicados
- [ ] CSV (manual), XLSX (`exceljs`), PDF (`pdfkit`) funcionais
- [ ] Gating por permissão + flag
- [ ] Limite de linhas com erro orientado
- [ ] Audit `reports.export` sem PII
- [ ] Testes: escopo respeitado no export, formatos válidos, sem PII no payload
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes
- [ ] Checklist LGPD §14.2 + justificativa de dependências no PR

## Validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- NUNCA reusar a query do front; reconstruir no backend a partir dos filtros validados.
- `exceljs` é obrigatório (CVE do `xlsx`). Registrar a escolha no PR.
- PDF: manter simples no MVP (tabela + cabeçalho institucional). Sem infra headless.
