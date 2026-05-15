---
id: F2-S11
title: Alinhar contrato do simulador com o backend (request/response) + input numérico
phase: F2
task_ref: F2.11
status: review
priority: high
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-15T16:57:31Z
completed_at: 2026-05-15T17:06:56Z
pr_url:
depends_on: [F2-S10]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/05-modulos-funcionais.md
---

# F2-S11 — Alinhar contrato do simulador + input numérico

## Contexto (incidentes 2026-05-15)

O simulador (F2-S06) foi construído no mesmo batch paralelo do backend (F2-S04). O agente
do frontend **adivinhou o contrato da API e errou**. Dois bugs em produção:

### Bug 1 — `POST /api/simulations` retorna 400

```
body/leadId Required, body/productId Required, body/amount Required, body/termMonths Required
```

O frontend envia `lead_id / product_id / requested_amount / term_months` (snake_case).
O backend espera `leadId / productId / amount / termMonths` (camelCase). O backend não
encontra os campos esperados → 400.

### Bug 2 — UX do campo de valor (máscara digit-shift)

O campo "Valor solicitado" usa `maskBRL` (estilo app de banco: cada dígito desloca a
vírgula). Para digitar R$ 30.000 o operador tecla 7 dígitos. Inconsistente com o
`PublishRuleDrawer` (F2-S07), que usa `<input type="number">` — digitar `30000` = 30000.

## Causa raiz comum

O contrato entre `apps/web/src/hooks/simulator/` e o backend nunca foi verificado contra
a fonte de verdade. **O backend é a fonte de verdade.** Este slot alinha o frontend ao
contrato real definido em `apps/api/src/modules/simulations/schemas.ts`.

## Contrato real do backend (fonte de verdade — confira no schema antes de implementar)

### Request — `POST /api/simulations` (`SimulationCreateSchema`)

```ts
{
  leadId: string; // UUID
  productId: string; // UUID
  amount: number; // reais, positivo
  termMonths: number; // inteiro positivo
}
```

### Response — `SimulationResponseSchema`

```ts
{
  id: string; // uuid
  organization_id: string; // uuid          (snake_case)
  lead_id: string; // uuid          (snake_case)
  product_id: string; // uuid          (snake_case)
  rule_version_id: string; // uuid
  amount_requested: string; // ⚠️ STRING (numeric do Postgres) — parsear p/ number
  term_months: number;
  monthly_payment: string; // ⚠️ STRING — parsear p/ number
  total_amount: string; // ⚠️ STRING — parsear p/ number
  total_interest: string; // ⚠️ STRING — parsear p/ number
  rate_monthly_snapshot: string; // ⚠️ STRING — parsear p/ number
  amortization_method: 'price' | 'sac';
  amortization_table: Array<{
    number: number; // nº da parcela (NÃO 'month')
    payment: number; // parcela total (NÃO 'installment')
    principal: number;
    interest: number;
    balance: number;
  }>;
  origin: 'manual' | 'ai' | 'import';
  created_by_user_id: string | null;
  created_at: string; // ISO datetime
}
```

**Atenção a 3 armadilhas:**

1. Request é camelCase; response top-level é snake_case (mistura — é o que o backend faz).
2. Valores monetários top-level vêm como **string** (`"5000.00"`) — converter para number.
3. As linhas de `amortization_table` usam `number`/`payment` — não `month`/`installment`
   como o frontend assumiu.

## Escopo

### 1. `hooks/simulator/types.ts`

- `SimulationBody` → request camelCase: `{ leadId, productId, amount, termMonths }`.
- `SimulationResult` / `AmortizationRow` → espelhar `SimulationResponseSchema` exatamente
  (campos, nomes, e o fato de os monetários virem como string). Decidir: ou o tipo
  reflete string e a UI converte na exibição, ou o `useSimulate` normaliza para number
  logo após o fetch (preferível — normalizar uma vez, UI sempre lida com number).

### 2. `hooks/simulator/useSimulate.ts`

- Montar o body do POST em camelCase (`leadId/productId/amount/termMonths`).
- Ao receber a resposta, parsear os campos string→number (`Number(amount_requested)` etc.).
- Garantir que o erro 400 não volte a acontecer — adicionar/ajustar teste.

### 3. `SimulatorForm.tsx`

- `handleFormSubmit` / `onSubmit` → emitir `{ leadId, productId, amount, termMonths }`.
- Renomear os campos internos do form RHF se estiverem snake_case, para consistência.
- **Input de valor numérico (Bug 2):** trocar `maskBRL` por `<input type="number">`
  consistente com `PublishRuleDrawer` (F2-S07) — digitar `30000` = R$ 30.000. `step`,
  `min`/`max` derivados da regra ativa. Hint de faixa continua via `formatBRL`.

### 4. `SimulatorResult.tsx` + `AmortizationTable.tsx`

- Consumir o response no shape correto. Parcela/total/juros = valores numéricos
  normalizados. A tabela usa `number`/`payment`/`principal`/`interest`/`balance`.

### 5. `maskBRL` / `parseBRL`

- Se ficarem sem uso após trocar o input, **remover** (sem código morto). Se outro
  consumidor existir, manter com justificativa. `formatBRL` permanece.

### 6. Testes

- Atualizar testes que assumiam snake_case ou o shape antigo.
- **Teste de contrato obrigatório:** o body emitido pelo submit tem exatamente as chaves
  `leadId, productId, amount, termMonths` — um teste que falharia com o bug atual.
- Teste de parsing do response (string→number).

## Verificação manual obrigatória (DoD)

Subir dev server + API e testar no browser:

1. `/simulator`, produto com regra `min R$ 5.000 / max R$ 30.000`.
2. Digitar `10000` no valor (não 7 dígitos) → R$ 10.000.
3. Simular `10000 / 12 meses` → **201**, resultado renderizado: parcela, total, juros,
   tabela de amortização coerentes (sem `NaN`, sem `R$ undefined`).
4. Conferir que não há mais 400.

Se não conseguir subir o ambiente, dizer explicitamente — não inventar que testou.

## Arquivos permitidos

- `apps/web/src/hooks/simulator/types.ts`
- `apps/web/src/hooks/simulator/useSimulate.ts`
- `apps/web/src/hooks/simulator/useProducts.ts`
- `apps/web/src/features/simulator/SimulatorForm.tsx`
- `apps/web/src/features/simulator/SimulatorResult.tsx`
- `apps/web/src/features/simulator/AmortizationTable.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorForm.test.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorResult.test.tsx`

## Definition of Done

- [ ] `POST /api/simulations` não retorna mais 400 — body em camelCase
      (`leadId/productId/amount/termMonths`).
- [ ] Response parseado corretamente — monetários string→number; sem `NaN`/`undefined`
      na UI.
- [ ] `amortization_table` lida com `number`/`payment`/`principal`/`interest`/`balance`.
- [ ] Campo de valor aceita número direto — digitar `30000` = R$ 30.000 (consistente
      com F2-S07).
- [ ] Hint de faixa correto via `formatBRL`; validação/submit em reais (sem regressão F2-S10).
- [ ] `maskBRL`/`parseBRL` removidos se sem uso (sem código morto).
- [ ] Teste de contrato: submit emite exatamente `{leadId, productId, amount, termMonths}`.
- [ ] Verificação manual no browser feita e descrita no PR.
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes (typecheck pode ter
      erro pré-existente em `lib/api.ts` — reportar, não arrumar).
- [ ] PR com screenshots (simulador funcionando ponta-a-ponta).

## Validação

```powershell
pnpm --filter @elemento/web test -- simulator
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
```
