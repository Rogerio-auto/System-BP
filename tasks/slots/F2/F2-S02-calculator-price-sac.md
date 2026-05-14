---
id: F2-S02
title: Service de cálculo Price + SAC (puro, testável)
phase: F2
task_ref: T2.2
status: in-progress
priority: high
estimated_size: S
agent_id: claude-code
claimed_at: 2026-05-14T18:18:10Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F2-S05, F2-S06]
source_docs: [docs/05-modulos-funcionais.md]
---

# F2-S02 — Service de cálculo Price + SAC (puro, testável)

## Objetivo

Implementar `calculate(input): SimulationResult` com fórmulas Price e SAC. Função pura, sem efeitos colaterais, sem dependências externas (sem Drizzle, Fastify, fs, db, logger). Testável em isolamento com Vitest.

## Escopo

- Implementar `apps/api/src/modules/simulations/calculator.ts`
- Implementar `apps/api/src/modules/simulations/types.ts` (tipos de input/output)
- Implementar `apps/api/src/modules/simulations/__tests__/calculator.test.ts`

## Fórmulas

### Price (sistema francês)

$$PMT = P \cdot \frac{i (1+i)^n}{(1+i)^n - 1}$$

Onde:

- `P` = principal (valor solicitado)
- `i` = taxa mensal decimal (ex: 0.02 para 2%)
- `n` = prazo em meses

Caso especial: quando `i === 0`, `PMT = P / n`.

Para cada parcela k (1..n):

- `interest_k = balance_{k-1} * i`
- `principal_k = PMT - interest_k`
- `balance_k = balance_{k-1} - principal_k`

### SAC (sistema de amortização constante)

- `principal_k = P / n` (constante)
- `interest_k = balance_{k-1} * i`
- `payment_k = principal_k + interest_k`
- `balance_k = balance_{k-1} - principal_k`

## Ajuste de resíduo (obrigatório)

Arredondar cada valor para 2 casas via `Math.round(v * 100) / 100`.

A soma dos campos `principal` das parcelas deve ser exatamente igual ao `amount` do input. Qualquer diferença residual causada por arredondamentos vai para a **última parcela** (ajuste de `principal` e `total`).

## Erros

Lançar `Error` com mensagens específicas:

- `amount` <= 0: `"amount must be positive"`
- `termMonths` <= 0: `"termMonths must be positive integer"`
- `monthlyRate` < 0: `"monthlyRate cannot be negative"`

## Estrutura de tipos esperada

```typescript
export interface SimulationInput {
  amount: number; // valor solicitado (positivo)
  termMonths: number; // prazo em meses (inteiro positivo)
  monthlyRate: number; // taxa mensal decimal (>= 0, ex: 0.02 = 2%)
  method: 'price' | 'sac';
}

export interface InstallmentRow {
  number: number; // 1..n
  payment: number; // parcela total
  principal: number; // amortização
  interest: number; // juros
  balance: number; // saldo devedor após pagamento
}

export interface SimulationResult {
  method: 'price' | 'sac';
  amount: number;
  termMonths: number;
  monthlyRate: number;
  installments: InstallmentRow[];
  totalPayment: number; // sum(payment)
  totalInterest: number; // sum(interest)
}
```

## Casos de teste obrigatórios

1. **Price 1000 / 12m / 2% mensal** → PMT ≈ 94.56 (aceitar ±0.01)
2. **Price 1000 / 12m / 0% mensal** → PMT = 83.33
3. **SAC 1200 / 12m / 1% mensal** → parcela 1 = 112.00, parcela 12 = 101.00
4. **SAC qualquer** → `sum(principal) === amount` exato
5. **Price qualquer** → `sum(principal) === amount` exato
6. **Erro: amount <= 0** → `Error("amount must be positive")`
7. **Erro: termMonths <= 0** → `Error("termMonths must be positive integer")`
8. **Erro: monthlyRate < 0** → `Error("monthlyRate cannot be negative")`

## Definition of Done

- [ ] `calculate` exportada de `calculator.ts`
- [ ] `SimulationInput`, `SimulationResult`, `InstallmentRow` exportadas de `types.ts`
- [ ] Todos os 8 casos de teste passando
- [ ] `sum(principal) === amount` garantido por ajuste na última parcela
- [ ] Arredondamento a 2 casas em todos os campos numéricos
- [ ] Sem `any`, sem `as`, TS strict
- [ ] Sem imports de Drizzle, Fastify, db, logger, fs
- [ ] `pnpm --filter @elemento/api test` verde

## Validação

```powershell
pnpm --filter @elemento/api test -- --reporter=verbose --testPathPattern=calculator
```

```powershell
pnpm --filter @elemento/api typecheck
```

## Arquivos permitidos

- `apps/api/src/modules/simulations/calculator.ts`
- `apps/api/src/modules/simulations/__tests__/calculator.test.ts`
- `apps/api/src/modules/simulations/types.ts`

## Arquivos proibidos

- Qualquer arquivo fora de `apps/api/src/modules/simulations/`
- `apps/api/src/db/**`
- `apps/api/package.json`
