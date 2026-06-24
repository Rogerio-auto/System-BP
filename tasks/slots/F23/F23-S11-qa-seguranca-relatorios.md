---
id: F23-S11
title: QA & Segurança — isolamento por papel, métricas×SQL e LGPD do export
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-24T17:57:53Z
completed_at: 2026-06-24T18:35:11Z
pr_url: null
depends_on: [F23-S07, F23-S08, F23-S10]
blocks: []
labels: [qa, security, reports, lgpd-impact, multi-tenant]
source_docs:
  [
    docs/planejamento-relatorios-metricas.md,
    docs/10-seguranca-permissoes.md,
    docs/17-lgpd-protecao-dados.md,
  ]
docs_required: false
---

# F23-S11 — QA & Segurança: gate final de relatórios

## Objetivo

Cobertura de teste e revisão de segurança que fecham a fase F23 antes do merge: provar
isolamento por papel/cidade/tenant, que toda métrica bate com SQL direto, e que nenhum
endpoint ou export vaza PII.

## Contexto

Plano §2 (princípios), §10/§11 (riscos: escopo é o maior risco de bug). Maior superfície de
regressão é o cruzamento papel × endpoint. Este slot adiciona testes onde a cobertura dos
slots anteriores ficou rasa e roda a revisão de segurança read-only.

> ⚠️ **Lacuna conhecida a fechar (lições S03/S04):** os testes de repository dos slots S03/S04
> são **mockados** — não executam SQL contra Postgres. Isso deixou passar 3 lotes de bugs de
> runtime (IN-list sem aspa de fechamento, `channels.kind` inexistente, aspa dupla como
> identificador, `AVG(MIN())` aninhado) que só a revisão manual pegou. Os endpoints de reports
> **NÃO** estão no fluxo do E2E Smoke. Este slot DEVE fechar isso: toda query de reports tem que
> ser **executada contra o Postgres de teste real** (o harness do `apps/api` já roda contra
> `postgres://test:test@localhost:5432/test` no CI — usar o mesmo, NÃO mockar `db.execute`).

## Escopo (faz)

- Testes de integração de **isolamento** para cada endpoint de `reports` (overview, funnel,
  attendance, ai, credit, collection, productivity, audit, export) × cada papel
  (admin, gestor_geral, gestor_regional, agente, operador, leitura, cobranca):
  - global vê tudo; city-scoped vê só suas cidades; self-scoped vê só a si.
  - cross-tenant: org A nunca enxerga org B.
  - filtro fora do escopo é rejeitado, não silenciosamente ampliado.
- **Execução real contra DB (obrigatório):** cada endpoint/query de reports roda contra o
  Postgres de teste com dados semeados — pega erro de SQL (coluna inexistente, sintaxe, aggregate
  aninhado, aspa) que teste mockado não pega. Sem mock de `db.execute` nesses testes.
- Testes de **paridade métrica×SQL** (amostra representativa de KPIs) — comparar o agregado do
  endpoint contra `SELECT` direto na(s) tabela(s)-fonte no mesmo DB semeado.
- Testes de **LGPD**: nenhum response/export contém CPF/telefone/nome de cidadão; D3 (agente
  não vê colegas nominalmente); export auditado sem PII.
- Revisão de segurança (`/hm-security` / security-reviewer) read-only sobre o diff de F23 com
  relatório anexado ao PR; sem gaps ALTO em aberto para fechar a fase.

## Fora de escopo (NÃO faz)

- Implementar features ou corrigir bugs de produção (abrir slot/finding se achar — read-only no app code).
- Editar código fora de testes/fixtures.

## Arquivos permitidos

- `apps/api/src/modules/reports/__tests__/`
- `apps/api/test/`
- `apps/web/src/features/relatorios/__tests__/`
- `docs/sessions/2026-XX-XX-reports-security.md`

## Arquivos proibidos

- `apps/api/src/modules/reports/{routes,controller,service,repository}.ts`
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `apps/api/src/db/migrations/**`

## Contratos de saída

- Suíte de isolamento cobre todos os endpoints × papéis relevantes (global/city/self/cross-tenant).
- Paridade métrica×SQL provada para os KPIs principais.
- Testes garantem ausência de PII em response e export e a regra D3.
- Relatório de segurança sem ALTO em aberto, anexado ao PR.

## Definition of Done

- [ ] **Toda query de reports executada contra Postgres real** (sem mock de `db.execute`) — overview/funnel/attendance/ai/credit/collection/productivity/export
- [ ] Testes de isolamento por papel/cidade/tenant para todos os endpoints de reports
- [ ] Testes de paridade métrica×SQL (endpoint vs SELECT direto no mesmo DB semeado)
- [ ] Testes de ausência de PII (response + export) e D3
- [ ] Revisão de segurança read-only + relatório no PR; sem ALTO aberto
- [ ] `pnpm --filter @elemento/api test` + `pnpm --filter @elemento/web test` verdes
- [ ] Checklist LGPD §14.2 na descrição do PR

## Validação

```powershell
pnpm --filter @elemento/api test
pnpm --filter @elemento/web test
python scripts/slot.py auto-review F23-S11 --json
```

## Notas para o agente

- Escopo é o maior risco: priorizar os testes de city-scope e self-scope.
- Comparar agregados das MVs/endpoints contra `SELECT` direto nas tabelas-fonte.
- Achou bug no app code? Reportar finding e abrir slot — não editar fora de testes.
