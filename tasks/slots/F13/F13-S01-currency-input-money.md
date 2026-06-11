---
id: F13-S01
title: CurrencyInput canônico + helpers de moeda (BRL)
phase: F13
task_ref: null
status: done
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: 2026-06-11T19:32:33Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/213
depends_on: []
blocks: [F13-S02]
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-c-correção-do-formato-de-real-item-3
  - docs/18-design-system.md
docs_required: false # infra/componente — sem feature visível nova até F13-S02 aplicar
docs_audience: []
docs_artifacts: []
---

# F13-S01 — CurrencyInput canônico + helpers de moeda (BRL)

## Objetivo

Criar um componente único `CurrencyInput` e helpers puros de formatação/parse de Real, eliminando as máscaras de moeda ad-hoc (causa-raiz do bug `10000 → R$ 100.000,00`).

## Contexto

Hoje não existe componente único de moeda no `apps/web` — cada tela faz máscara à mão, o que gera o deslocamento de casa decimal (item 3 do planejamento). Este slot entrega a fundação reutilizável; o F13-S02 aplica nas telas e corrige o bug. Decisão D5: representação interna em **centavos inteiros** (sem float).

## Escopo (faz)

- `lib/format/money.ts`:
  - `formatBRL(valueInCents: number): string` → `"R$ 1.234,56"` via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
  - `formatBRLNumber(reais: number): string` (conveniência para valores já em reais vindos da API como `numeric`).
  - `parseBRLToCents(masked: string): number` → lê texto mascarado/digitado e devolve **centavos inteiros** (nunca multiplica casa indevidamente).
  - `centsToReais(cents)` / `reaisToCents(reais)` para a borda com a API (que usa `numeric(14,2)` em reais).
- `components/ui/CurrencyInput.tsx`:
  - Input controlado que mantém o valor em **centavos** internamente e exibe formatado.
  - Props compatíveis com React Hook Form (`value`, `onChange(cents)`, `name`, `error`, `label`, `disabled`).
  - Segue o Design System (mesmos tokens/estilos do `components/ui/Input.tsx`).
- Testes cobrindo o caso de regressão: digitar `10000` resulta em `R$ 10.000,00` (e não `R$ 100.000,00`), incluindo apagar, colar e zero.

## Fora de escopo (NÃO faz)

- Migrar telas existentes para o `CurrencyInput` (é o F13-S02).
- Qualquer mudança em backend ou em `numeric` da API.

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/lib/format/money.ts`
- `apps/web/src/lib/format/__tests__/money.test.ts`
- `apps/web/src/components/ui/CurrencyInput.tsx`
- `apps/web/src/components/ui/__tests__/CurrencyInput.test.tsx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/components/ui/Input.tsx` (não alterar o Input base)
- Qualquer `features/**` (migração é o F13-S02)

## Contratos de saída

- `CurrencyInput` e `parseBRLToCents`/`formatBRL` exportados e estáveis para o F13-S02 consumir.

## Definition of Done

- [ ] `money.ts` + `CurrencyInput.tsx` implementados conforme escopo
- [ ] Teste de regressão `10000 → R$ 10.000,00` verde
- [ ] `pnpm --filter @elemento/web typecheck` verde
- [ ] `pnpm --filter @elemento/web lint` verde
- [ ] `pnpm --filter @elemento/web test` verde (novos testes incluídos)
- [ ] Design System aplicado (tokens canônicos, sem cores hardcoded)

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- money
pnpm --filter @elemento/web test -- CurrencyInput
```

## Notas para o agente

- Centavos inteiros internamente; converter só na borda (API espera reais em `numeric`). Ver `centsToReais`.
- `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` já entrega `R$ x.xxx,xx`.
- Não reintroduzir lógica de "trata input como centavos e multiplica" — é exatamente o bug.
