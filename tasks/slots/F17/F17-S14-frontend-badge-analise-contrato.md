---
id: F17-S14
title: Frontend — badge "Contrato vinculado" na ficha da análise
phase: F17
task_ref: null
status: available
priority: medium
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F17-S12, F17-S13, F17-S06]
blocks: []
labels: [contracts, credit-analyses, frontend]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: false
---

# F17-S14 — Frontend badge análise → contrato vinculado

## Objetivo

Na ficha da análise de crédito (`CreditAnalysisDetailPage`), exibir um badge/link para o contrato gerado automaticamente pela aprovação, fechando o loop visual análise → contrato.

## Contexto

Quando a análise é aprovada, F17-S13 cria um contrato draft automaticamente. O operador precisa de visibilidade disso na tela da análise para navegar diretamente ao contrato — sem precisar procurar na aba de contratos.

## Escopo (faz)

- Hook `useContractByAnalysis(analysisId: string)` em `apps/web/src/features/contracts/hooks.ts`:
  - Chama `GET /api/contracts?analysis_id=:analysisId&limit=1`
  - Retorna `contract | null`
- Componente `LinkedContractBadge` em `apps/web/src/features/contracts/LinkedContractBadge.tsx`:
  - Se contrato existe: badge com status, referência e link para `/contratos` (abre a ficha do contrato)
  - Se não existe: null (não renderiza nada)
  - Skeleton durante loading
  - DS: badge com status-color + ícone de documento + texto `Contrato {reference}` + chevron direito
- Integrar em `CreditAnalysisDetailPage.tsx`:
  - Seção "Contrato vinculado" (visível apenas quando `analysis.status === 'aprovado'`)
  - `<LinkedContractBadge analysisId={analysis.id} />`

## Fora de escopo (NÃO faz)

- Criar contrato pela tela da análise (F17-S11 cobre criação manual)
- Editar contrato pela tela da análise

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/contracts/LinkedContractBadge.tsx`
- `apps/web/src/features/contracts/hooks.ts`
- `apps/web/src/features/contracts/api.ts`
- `apps/web/src/features/contracts/index.ts`
- `apps/web/src/features/credit-analyses/CreditAnalysisDetailPage.tsx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/App.tsx`
- `apps/web/src/features/credit-analyses/` (exceto `CreditAnalysisDetailPage.tsx`)
- `apps/web/src/features/crm/**`

## Contratos de entrada

- `GET /api/contracts?analysis_id=:uuid` (F17-S13)
- `ContractSchema.analysis_id` (F17-S12) — `analysis_id` disponível no response
- `CreditAnalysisDetailPage` já existe em `apps/web/src/features/credit-analyses/`

## Definition of Done

- [ ] Badge aparece na ficha da análise aprovada com status + referência do contrato
- [ ] Clique navega para `/contratos` (ou abre ContractDetail se possível)
- [ ] Não aparece se análise não for `aprovado` ou se nenhum contrato vinculado
- [ ] DS aplicado (tokens, sem hex hardcoded)
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- credit-anal
```

## Notas para o agente

- **Leia `CreditAnalysisDetailPage.tsx` completo** antes de editar — veja onde inserir a seção "Contrato vinculado" (provavelmente logo abaixo do status badge ou ao lado dos campos de aprovação `approved_amount`, `approved_term_months`).
- **Leia `contracts/hooks.ts` e `contracts/api.ts`** antes de adicionar o hook — siga o padrão existente de `CONTRACT_KEYS` e `fetchContracts`.
- O badge deve ser **pequeno e contextual** — não uma seção grande. Pense: "pill clicável com status color + texto `ANA-2026-A3F7D63D · draft` + →".
- Se o `ContractDetail` drawer puder ser aberto inline (sem navegar para `/contratos`), prefira isso para UX mais fluida. Importe `ContractDetail` de `features/contracts` se já estiver exportado.
- Evite `{#anchor}` e `{{texto}}` em qualquer mdx que toque.
