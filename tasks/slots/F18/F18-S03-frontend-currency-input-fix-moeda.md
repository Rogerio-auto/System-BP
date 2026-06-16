---
id: F18-S03
title: Frontend — CurrencyInput canônico + fix bug de moeda (Onda 1 item 3)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-c--correção-do-formato-de-real-item-3-
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T05:07:15Z
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: [frontend, bug, currency, simulation]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S03 — Frontend: CurrencyInput canônico + fix bug de moeda

## Objetivo

Criar um componente `CurrencyInput` canônico e corrigir o bug onde `10000` é exibido como `R$ 100.000,00` (×10) nos formulários de simulação e análise de crédito.

## Contexto

Item 3 (Onda 1 quick win). O bug ocorre na simulação manual e no formulário de criação de análise (campo de valor). A causa-raiz: campos `type="number"` com máscara manual ad-hoc deslocam casas decimais. Decisão D5: representação interna em **centavos inteiros** ou `number` em reais — por simplicidade do contexto (campos já enviam string/number), usar `number` em reais (float arredondado a 2 casas) internamente e exibir via `Intl.NumberFormat('pt-BR')`.

## Escopo (faz)

### 1. `apps/web/src/components/ui/CurrencyInput.tsx`

- Input controlado que exibe valor em BRL (`R$ 1.234,56`) durante exibição, mas armazena e emite como `number` em reais (ex: `1234.56`).
- Props: `value: number | null`, `onChange(v: number | null): void`, `placeholder?`, `disabled?`, `className?`, `error?`.
- Estratégia: `type="text"` com máscara aplicada no `onBlur` (ao sair do campo, formatar); no `onFocus`, exibir só o número sem símbolo para facilitar edição. No `onChange`, parsear digits-only.
- Helper `parseBRLInput(raw: string): number | null` em `apps/web/src/lib/format/money.ts`.
- Helper `formatBRL(v: number): string` em `apps/web/src/lib/format/money.ts` (via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`).

### 2. Corrigir formulário de simulação manual

Substituir o campo de valor no `SimulationForm.tsx` (ou onde o bug ocorre — verificar) por `<CurrencyInput>`. O valor enviado à API deve ser `number` em reais (ex: `10000` → envia `10000`, não `"1000000"` centavos).

### 3. Corrigir formulário de análise de crédito

Verificar `DecideModal.tsx` / `CreditAnalysisForm.tsx` — substituir campos de valor monetário por `<CurrencyInput>`.

### 4. Teste de regressão

`apps/web/src/components/ui/__tests__/CurrencyInput.test.tsx`:

- Digitar `10000` → `onChange` recebe `10000` (não `100000`).
- `formatBRL(10000)` retorna `"R$ 10.000,00"`.
- `parseBRLInput("10.000,00")` retorna `10000`.

## Fora de escopo (NÃO faz)

- Migrar TODAS as ocorrências de `toLocaleString` (15+ arquivos) — só corrigir os campos com o bug reportado.
- Backend — o bug é só de máscara no front.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/components/ui/CurrencyInput.tsx`
- `apps/web/src/components/ui/__tests__/CurrencyInput.test.tsx`
- `apps/web/src/lib/format/money.ts`
- `apps/web/src/features/simulations/**`
- `apps/web/src/features/credit-analyses/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`

## Definition of Done

- [ ] `CurrencyInput` renderiza `R$ 10.000,00` ao receber `10000`.
- [ ] Formulário de simulação: digitar `10000` → API recebe `10000`.
- [ ] Formulário de análise: campos monetários corrigidos.
- [ ] Teste `CurrencyInput.test.tsx` cobre os 3 cenários (render, parse, format).
- [ ] `pnpm --filter @elemento/web typecheck && lint && test -- CurrencyInput` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- CurrencyInput
```

## Notas para o agente

- **Leia o arquivo com o bug primeiro:** procure o campo de valor no `SimulationForm.tsx` ou equivalente — identifique onde o `10000` vira `100.000` (provavelmente `type="number"` combinado com máscara aplicada na exibição que multiplica por 100).
- O campo enviado à API de simulação é numérico — verifique o schema do SimulationCreateSchema para confirmar o tipo esperado.
- `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` é a única referência canônica de formatação — não usar `.toLocaleString()` ad-hoc.
