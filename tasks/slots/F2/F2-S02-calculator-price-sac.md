---
id: F2-S02
title: Service de cálculo Price + SAC (puro, testável)
phase: F2
task_ref: T2.2
status: available
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: []
blocks: [F2-S04]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/12-tasks-tecnicas.md
---

# F2-S02 — Calculator Price + SAC (puro)

## Objetivo

Funções puras de cálculo de financiamento por sistema **Price** (parcelas fixas) e **SAC**
(amortização constante). Sem I/O, sem dependência de Drizzle/Fastify — apenas math.
Reusado por F2-S04 (`POST /api/simulations`) e F2-S05 (`POST /internal/simulations`).

## Escopo

Arquivo único `apps/api/src/modules/simulations/calculator.ts` + testes.

### Tipos

```ts
type Amortization = 'price' | 'sac';

interface SimulationInput {
  amount: number; // P — valor solicitado (>0)
  termMonths: number; // n — prazo em meses (>=1)
  monthlyRate: number; // i — taxa mensal decimal (>=0)
  amortization: Amortization;
}

interface AmortizationRow {
  n: number; // 1..termMonths
  principal: number; // amortização do principal no mês
  interest: number; // juros do mês
  payment: number; // parcela total do mês
  balance: number; // saldo devedor após pagar a parcela
}

interface SimulationResult {
  monthlyPayment: number; // Price: fixo; SAC: parcela do mês 1 (primeira parcela)
  totalAmount: number; // sum(payment) — quanto o cliente vai pagar no total
  totalInterest: number; // totalAmount - amount
  amortizationTable: AmortizationRow[];
}
```

### Fórmula Price (doc 05 §"Crédito")

```
PMT = P · ( i · (1+i)^n ) / ( (1+i)^n − 1 )
```

Se `i = 0` (taxa zero), `PMT = P / n` (caso especial — evitar divisão por zero).

### Fórmula SAC

- Amortização constante: `principalMonthly = P / n`
- Saldo no mês k: `balance_k = P − k · principalMonthly`
- Juros do mês k: `interest_k = (balance_{k-1}) · i`
- Parcela do mês k: `payment_k = principalMonthly + interest_k`

`monthlyPayment` retornado para SAC = `payment_1` (primeira parcela, a maior).

### Precisão decimal

- **NÃO** usar `number` cru para somas finais — acúmulo de erro float.
- Calcular linha-a-linha com `number`, mas arredondar cada `principal`, `interest`,
  `payment` para 2 casas via `Math.round(v * 100) / 100`.
- Garantir que `sum(principal) === amount` ajustando a última parcela (diferença residual
  vai pra última linha).
- `totalAmount = sum(payment)` recalculado a partir da tabela já arredondada.

### Casos de erro (lançar `Error` simples — slot é puro)

- `amount <= 0` → `'amount must be positive'`
- `termMonths < 1` ou não-inteiro → `'termMonths must be a positive integer'`
- `monthlyRate < 0` → `'monthlyRate must be >= 0'`
- `amortization` inválida → `'amortization must be price or sac'`

## Arquivos permitidos

- `apps/api/src/modules/simulations/calculator.ts`
- `apps/api/src/modules/simulations/__tests__/calculator.test.ts`
- `apps/api/src/modules/simulations/types.ts` (tipos compartilhados — opcional, pode ficar no calculator.ts)

## Definition of Done

- [ ] `calculate(input): SimulationResult` exportada.
- [ ] Casos conhecidos cobertos por teste:
  - Price 1000 / 12m / 2% mensal → PMT ≈ 94,56
  - Price 1000 / 12m / 0% → PMT = 83,33
  - SAC 1200 / 12m / 1% → parcela 1 = 112, parcela 12 = 101
- [ ] `sum(principal) === amount` exatamente (ajuste residual em última parcela).
- [ ] `amortizationTable.length === termMonths`.
- [ ] Casos de erro com mensagem correta.
- [ ] Função **pura**: zero importação de banco/HTTP/fs/logger.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.
- [ ] PR aberto.

## Validação

```powershell
pnpm --filter @elemento/api test -- simulations/calculator
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
