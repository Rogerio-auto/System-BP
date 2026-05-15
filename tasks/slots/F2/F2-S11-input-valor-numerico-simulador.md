---
id: F2-S11
title: Substituir máscara digit-shift do simulador por input numérico
phase: F2
task_ref: F2.11
status: available
priority: medium
estimated_size: S
agent_id: frontend-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F2-S10]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
---

# F2-S11 — Input de valor numérico no simulador

## Contexto

O campo "Valor solicitado" do simulador (`SimulatorForm`, F2-S06) usa `maskBRL` —
máscara "digit-shift" estilo app de banco: cada dígito digitado desloca a vírgula,
interpretando a entrada como centavos durante a digitação. Para digitar **R$ 30.000**
o operador precisa teclar **7 dígitos** (`3000000`).

F2-S10 corrigiu a unidade (o valor consumido pela validação/submit já é reais), mas
manteve essa UX de digitação. O resultado é inconsistente com o resto do produto:

- `PublishRuleDrawer` (F2-S07, gestão de produtos) usa `<input type="number">` com
  `valueAsNumber` — digitar `30000` resulta em `30000`.
- O simulador usa `maskBRL` — digitar `30000` resulta em `R$ 300,00`.

O mesmo operador cadastra a regra de um jeito e simula de outro. Confuso.

## Objetivo

Alinhar o campo de valor do simulador ao padrão do `PublishRuleDrawer`: **digitar
`30000` deve significar R$ 30.000**, sem máscara centavos-first.

## Escopo

### `SimulatorForm.tsx`

- Trocar o input que usa `maskBRL` por um campo numérico direto, consistente com
  `PublishRuleDrawer` (F2-S07): `type="number"`, `step`, `min`/`max` derivados da regra
  ativa, leitura como número (reais).
- Manter o feedback visual do DS: o hint de faixa ("Faixa: R$ 5.000,00 – R$ 30.000,00")
  continua via `formatBRL`. Opcionalmente, exibir o valor formatado em `formatBRL` ao
  lado/abaixo do input como confirmação (read-only) — decisão de UX no PR, mas o **input
  em si** aceita número puro.
- A validação Zod (já em reais após F2-S10) passa a ler o número direto, sem `parseBRL`.
- O submit envia `requested_amount` em reais (já correto desde F2-S10).

### `hooks/simulator/types.ts`

- `maskBRL` e `parseBRL`: se deixarem de ser usados pelo `SimulatorForm`, avaliar:
  - Se nenhum outro consumidor → **remover** as funções mortas (não deixar código morto).
  - Se algum outro lugar usa → manter, mas garantir que não há regressão.
- `formatBRL` permanece (usado para exibição em vários lugares).
- `SimulatorFormValues.amount_display: string` → reavaliar: se o input vira numérico,
  o campo do form passa a ser `amount: number` (ou manter string com parse simples).
  Ajustar o tipo coerentemente.

## Verificação manual obrigatória (DoD)

Subir o dev server e testar no browser:

1. Abrir `/simulator`, selecionar produto com regra `min R$ 5.000 / max R$ 30.000`.
2. Digitar `10000` no campo de valor → deve representar R$ 10.000 (não R$ 100).
3. Simular `10000 / 12 meses` → cria a simulação, resultado coerente.
4. Digitar `4999` → validação rejeita ("entre R$ 5.000,00 e R$ 30.000,00").

Se não conseguir subir o ambiente, dizer explicitamente — não inventar que testou.

## Arquivos permitidos

- `apps/web/src/features/simulator/SimulatorForm.tsx`
- `apps/web/src/features/simulator/__tests__/SimulatorForm.test.tsx`
- `apps/web/src/hooks/simulator/types.ts`

## Definition of Done

- [ ] Campo de valor do simulador aceita número direto — digitar `30000` = R$ 30.000.
- [ ] Comportamento consistente com o `PublishRuleDrawer` (F2-S07).
- [ ] Hint de faixa continua correto via `formatBRL`.
- [ ] Validação e submit operam em reais (sem regressão do F2-S10).
- [ ] `maskBRL`/`parseBRL` removidos se ficarem sem uso (sem código morto) — ou mantidos
      com justificativa se ainda houver consumidor.
- [ ] Testes atualizados.
- [ ] Verificação manual no browser feita e descrita no PR.
- [ ] `pnpm --filter @elemento/web typecheck && lint && test` verdes (typecheck pode ter
      erro pré-existente em `lib/api.ts` — reportar, não arrumar).
- [ ] PR com screenshot do campo.

## Validação

```powershell
pnpm --filter @elemento/web test -- simulator
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web typecheck
```
