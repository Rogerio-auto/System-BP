---
id: F2-S10
title: Fix unidade monetária do simulador (centavos → reais)
phase: F2
task_ref: F2.10
status: review
priority: critical
estimated_size: M
agent_id: frontend-engineer
claimed_at: 2026-05-15T14:41:08Z
completed_at: 2026-05-15T14:50:36Z
pr_url:
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/18-design-system.md
---

# F2-S10 — Fix unidade monetária do simulador

## Contexto (incidente 2026-05-15)

O usuário cadastrou uma regra de crédito com `min_amount = R$ 5.000` e
`max_amount = R$ 30.000` (via F2-S07, gestão de produtos). Ao abrir o simulador
(`/simulator`), a validação exibiu **"Valor deve estar entre R$ 50,00 e R$ 300,00"** —
todos os valores divididos por 100.

## Causa raiz

O módulo do simulador (F2-S06) foi construído inteiro assumindo a unidade **centavos**,
mas o backend trabalha em **reais**. Inconsistência de contrato.

Evidências em `apps/web/src/hooks/simulator/types.ts`:

```ts
export interface ProductRule {
  min_amount: number; // centavos   ← ERRADO: backend retorna reais
  max_amount: number; // centavos
}
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', ... });  // ÷100
}
export function parseBRL(display: string): number {
  ...
  return Math.round(value * 100);   // ×100
}
export function maskBRL(raw: string): string {
  const cents = parseInt(digits, 10);   // trata input como centavos
  return (cents / 100).toLocaleString(...);
}
```

E `SimulatorForm.tsx`:

```ts
const cents = parseBRL(v);
return cents >= rule.min_amount && cents <= rule.max_amount;
```

**O backend é todo em reais:**

- `credit_product_rules.min_amount` / `max_amount` → `numeric(14,2)` → ex: `5000.00`
- `POST /api/simulations` body → `amount: number` em reais (F2-S04)
- `credit_simulations.amount_requested` / `monthly_payment` / `total_amount` → `numeric(14,2)` em reais
- O calculator (F2-S02) opera em reais
- F2-S07 (`PublishRuleDrawer`) salva `minAmount`/`maxAmount` em reais — **correto**, não mexer

Consequências do bug:

1. Limites exibidos ÷100 ("R$ 50,00" em vez de "R$ 5.000,00")
2. Validação compara centavos (`parseBRL` ×100) contra limites em reais → sempre torta
3. Submit enviaria `requested_amount` ×100 → backend recebe valor 100× maior → 422 ou
   simulação errada

Os 59 testes de F2-S06 passaram porque testavam round-trip interno centavos↔centavos —
autoconsistente, mas com a premissa errada. Nenhum teste confrontou o contrato do backend.

## Objetivo

Converter o módulo do simulador para operar em **reais** (decimal com 2 casas),
consistente com o backend e com F2-S07. Auditar F2-S08 (histórico/modal de simulações)
pelo mesmo bug.

## Escopo

### 1. `hooks/simulator/types.ts`

- Remover toda a semântica de "centavos". Tipos `ProductRule`, `SimulationResult`,
  `AmortizationRow`, `SimulationBody` etc. passam a documentar **reais**.
- `formatBRL(reais: number)` → formata direto sem dividir por 100.
- `parseBRL(display: string)` → retorna reais (float com 2 casas), **sem** `×100`.
- `maskBRL` → reavaliar. Se a máscara "centavos-first" (cada dígito desloca) for
  desejada como UX de digitação, manter a UX MAS o valor final exposto ao form/submit
  deve ser **reais**. Alternativa mais simples: input numérico comum com separador de
  milhar no blur. Decisão de UX documentada no PR — o importante é o valor consumido
  pela validação e pelo submit ser reais.

### 2. `SimulatorForm.tsx`

- Renomear `cents` → `amount` (ou similar). A validação compara reais contra
  `rule.min_amount`/`max_amount` (reais).
- `handleFormSubmit`: `requested_amount` enviado ao `POST /api/simulations` em reais.
- Hint de faixa (`formatBRL(rule.min_amount)`) exibe valor correto.

### 3. `SimulatorResult.tsx` + `AmortizationTable.tsx`

- Parcela, total, juros, saldo — todos vêm do backend em reais. Exibir via `formatBRL`
  corrigida (sem ÷100).
- Conferir a tabela de amortização: as colunas Principal/Juros/Parcela/Saldo devem bater
  com a resposta real do backend.

### 4. Auditoria de F2-S08 (histórico de simulações)

F2-S08 implementou `SimulationHistory.tsx`, `SimulationDetailModal.tsx` e
`components/credit/AmortizationTable.tsx`. Verificar se eles têm `formatBRL` próprio ou
importam o de simulator. **Se reproduzirem o bug de centavos, corrigir junto.** Se já
estiverem corretos (reais), apenas confirmar no PR. Garantir que só exista UMA função
canônica de formatação de moeda reutilizada — não duas com semânticas diferentes.

### 5. Testes

- Atualizar os testes de F2-S06 que assumiam centavos.
- Adicionar teste de contrato: dado `rule.min_amount = 5000` (reais), o hint exibe
  "R$ 5.000,00" e a validação aceita `10000` e rejeita `4999`.
- Teste de submit: form com `R$ 10.000` envia `requested_amount: 10000` (não 1000000).

## Verificação manual obrigatória (DoD)

Subir o dev server e testar no browser:

1. Criar/usar produto com regra `min R$ 5.000 / max R$ 30.000`.
2. Abrir `/simulator` → o hint deve dizer "Faixa: R$ 5.000,00 – R$ 30.000,00".
3. Simular `R$ 10.000 / 12 meses` → deve criar a simulação (não 422), resultado coerente.
4. Conferir o histórico na ficha do lead (F2-S08) — valores corretos.

## Arquivos permitidos

- `apps/web/src/hooks/simulator/types.ts`
- `apps/web/src/features/simulator/SimulatorForm.tsx`
- `apps/web/src/features/simulator/SimulatorResult.tsx`
- `apps/web/src/features/simulator/AmortizationTable.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorForm.test.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorResult.test.tsx`
- `apps/web/src/hooks/simulator/useSimulate.ts`
- `apps/web/src/hooks/simulator/useProducts.ts`
- `apps/web/src/components/credit/AmortizationTable.tsx`
- `apps/web/src/features/crm/components/SimulationHistory.tsx`
- `apps/web/src/features/crm/components/SimulationDetailModal.tsx`
- `apps/web/src/features/crm/components/__tests__/SimulationHistory.test.tsx`
- `apps/web/src/hooks/crm/useLeadSimulations.ts`
- `apps/web/src/hooks/crm/types.ts`

## Definition of Done

- [ ] Nenhuma função do simulador divide/multiplica por 100 por causa de "centavos".
- [ ] `formatBRL` formata reais direto; `parseBRL` retorna reais.
- [ ] Hint de faixa exibe "R$ 5.000,00 – R$ 30.000,00" para regra com min 5000 / max 30000.
- [ ] Validação aceita/rejeita valores comparando reais contra reais.
- [ ] Submit envia `requested_amount` em reais.
- [ ] F2-S08 auditado: histórico e modal exibem valores corretos; uma única função
      canônica de formatação de moeda.
- [ ] Testes atualizados + teste de contrato (5000 reais → "R$ 5.000,00").
- [ ] Verificação manual no browser feita (descrita no PR com o resultado).
- [ ] `pnpm typecheck && lint && test` verdes (typecheck pode ter erro pré-existente em
      `lib/api.ts` — reportar, não arrumar).
- [ ] PR com screenshots (simulador com faixa correta + resultado).

## Validação

```powershell
pnpm --filter @elemento/web test -- simulator
pnpm --filter @elemento/web test -- crm
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
```
