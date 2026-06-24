---
id: F23-S08
title: Frontend — seções Crédito, Cobrança, Produtividade e Auditoria
phase: F23
task_ref: docs/planejamento-relatorios-metricas.md
status: review
priority: medium
estimated_size: L
agent_id: null
claimed_at: 2026-06-24T16:20:31Z
completed_at: 2026-06-24T16:42:44Z
pr_url: null
depends_on: [F23-S04, F23-S05, F23-S06]
blocks: []
labels: [frontend, reports, design-system]
source_docs: [docs/planejamento-relatorios-metricas.md, docs/18-design-system.md]
docs_required: true
docs_artifacts: [docs/help/relatorios/credito-cobranca-produtividade.mdx]
---

# F23-S08 — Frontend: seções Crédito, Cobrança, Produtividade e Auditoria

## Objetivo

Completar as seções de relatório: Crédito (§4-E), Cobrança & Carteira (§4-F), Produtividade
(§4-G) e Auditoria & Operação (§4-H), consumindo os endpoints já entregues.

## Contexto

Plano §4-E/F/G/H, §3. Depende do shell (F23-S06) e dos endpoints de F23-S04 (credit/collection/
productivity) e F23-S05 (audit). Aplicar D3 na UI de produtividade: gestor vê ranking nominal,
agente vê só a si + média (o backend já corta os dados; a UI só apresenta). Cobrança visível
para quem tem `billing:read` (inclui gestor_regional escopado, F23-S02).

## Escopo (faz)

- Componentes de seção + hooks (`useReportsCredit`, `useReportsCollection`, `useReportsProductivity`, `useReportsAudit`).
- Seção Crédito: funil simulação→análise→contrato, taxas aprovação/rejeição/default, valores.
- Seção Cobrança: 5 cards de carteira, adimplência/inadimplência, dias de atraso, eficiência, PIX vs boleto.
- Seção Produtividade: ranking/quadro por agente (D3 na apresentação).
- Seção Auditoria: ações por tipo/ator, alterações críticas, saúde de eventos/DLQ.
- Renderização por permissão; filtros globais; estados loading/empty/error.
- Doc `docs/help/relatorios/credito-cobranca-produtividade.mdx`.

## Fora de escopo (NÃO faz)

- Exportação (F23-S10).
- Endpoints (já entregues).
- Seções de F23-S07.

## Arquivos permitidos

- `apps/web/src/features/relatorios/components/`
- `apps/web/src/features/relatorios/hooks/`
- `apps/web/src/features/relatorios/api.ts`
- `apps/web/src/features/relatorios/RelatoriosPage.tsx`
- `docs/help/relatorios/credito-cobranca-produtividade.mdx`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/src/features/dashboard/**`
- `apps/web/src/app/App.tsx`

## Contratos de saída

- 4 seções renderizam dados reais, respeitando filtros e permissões.
- Cobrança visível a `billing:read` (gestor_regional vê só suas cidades).
- Produtividade aplica D3 na apresentação.
- DS respeitado; tipos do schema compartilhado; sem `any`.

## Definition of Done

- [ ] Seções Crédito, Cobrança, Produtividade e Auditoria funcionais
- [ ] Hooks consumindo credit/collection/productivity/audit
- [ ] Gating por permissão (billing:read, dashboard:read_by_agent, audit:read)
- [ ] D3 refletida na UI de produtividade
- [ ] Doc de ajuda criada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- Slot irmão de F23-S07 (mesma página/api.ts) — rodar em sequência ou worktree isolada para evitar colisão.
- `.mdx` novo → rodar teste do WEB antes do push.
- Reusar os 5 cards de carteira do `CollectionDashboardPage` como referência (não editar o dashboard).
