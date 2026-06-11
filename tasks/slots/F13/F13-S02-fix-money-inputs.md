---
id: F13-S02
title: Aplicar CurrencyInput nas telas de valor + corrigir bug ×10
phase: F13
task_ref: null
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F13-S01]
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-c-correção-do-formato-de-real-item-3
docs_required: false # correção de bug em telas existentes — sem nova capacidade documentável
docs_audience: []
docs_artifacts: []
---

# F13-S02 — Aplicar CurrencyInput nas telas de valor + corrigir bug ×10

## Objetivo

Substituir as máscaras de moeda ad-hoc das telas de valor pelo `CurrencyInput` (F13-S01) e eliminar o bug `10000 → R$ 100.000,00`, garantindo round-trip correto ao salvar e reabrir.

## Contexto

Item 3 do planejamento. O bug é de máscara/exibição no front (a API já usa `numeric(14,2)` correto). A tela exata onde o Rogério reproduziu ainda está pendente de confirmação — por isso o slot **audita e migra todas as telas de entrada/edição de valor**, reproduzindo o caso `10000` em cada uma.

## Escopo (faz)

- Auditar e migrar para `CurrencyInput` os campos de valor em:
  - Simulação manual (`features/simulator`) — valor solicitado.
  - Análise de crédito (`features/credit-analyses/components/CreditAnalysisForm.tsx`) — `approved_amount` no DecideModal/AddVersionModal.
  - Cobrança (`features/billing`) — valor em modais/listagens de parcela onde houver input.
- Garantir conversão correta na borda da API (reais ↔ centavos) em cada submit/preenchimento.
- Auditar **exibições** com `toLocaleString`/máscara manual nas mesmas features e trocar por `formatBRL`/`formatBRLNumber`.
- Teste de regressão por tela: digitar `10000`, salvar, reabrir → exibir `R$ 10.000,00`.

## Fora de escopo (NÃO faz)

- Criar o componente (é o F13-S01 — apenas consumir).
- Telas de CRM/Kanban (F13-S03), produtos (F13-S06), dashboard (F13-S05).
- Qualquer mudança de schema/`numeric` no backend.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/simulator/**`
- `apps/web/src/features/credit-analyses/components/CreditAnalysisForm.tsx`
- `apps/web/src/features/credit-analyses/components/__tests__/**`
- `apps/web/src/features/billing/components/MarkPaidModal.tsx`
- `apps/web/src/features/billing/PaymentDuesPage.tsx`
- `apps/web/src/features/billing/__tests__/**`
- `apps/web/src/hooks/simulator/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/lib/format/money.ts` (dono é F13-S01)
- `apps/web/src/components/ui/CurrencyInput.tsx` (dono é F13-S01)
- `apps/web/src/features/crm/**` (dono é F13-S03)

## Contratos de entrada

- `CurrencyInput`, `parseBRLToCents`, `formatBRL`, `centsToReais`/`reaisToCents` (F13-S01).

## Definition of Done

- [ ] Todas as telas de valor listadas usam `CurrencyInput`
- [ ] Reproduzido e corrigido: `10000` salva/exibe `R$ 10.000,00` em cada tela
- [ ] Exibições com `toLocaleString` ad-hoc trocadas por `formatBRL`/`formatBRLNumber`
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde (testes de regressão por tela)

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- simulator
pnpm --filter @elemento/web test -- credit-analyses
pnpm --filter @elemento/web test -- billing
```

## Notas para o agente

- O `DecideModal` (credit-analyses) hoje usa `type="number"` puro com `parseFloat` — pode estar correto; ainda assim padronizar para `CurrencyInput` para consistência e cobrir com teste.
- Confirmar com o Rogério a tela exata caso a auditoria não reproduza o ×10 (pendência registrada no planejamento).
- API recebe/devolve reais (`numeric`); converter para centavos só na UI.
