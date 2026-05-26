---
id: F8-S15
title: Fix loop infinito em SimulationSelect (regressão F8-S14)
phase: F8
task_ref: hotfix
status: in-progress
priority: high
estimated_size: XS
agent_id: ''
claimed_at: 2026-05-26T20:12:19Z
completed_at: ''
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - tasks/slots/F8/F8-S14-substituir-uuid-inputs-por-comboboxes.md
  - apps/web/src/components/comboboxes/SimulationSelect.tsx
  - apps/web/src/components/comboboxes/LeadCombobox.tsx
  - apps/web/src/components/comboboxes/CityCombobox.tsx
---

# F8-S15 — Fix loop infinito em `SimulationSelect`

## Contexto (incidente 2026-05-26, pós-merge F8-S14)

Após merge de F8-S14 (substituir inputs UUID por comboboxes), Rogério abriu a
página de credit-analyses → "Nova análise" e o React derruba console com:

```
SimulationSelect.tsx:72 Warning: Maximum update depth exceeded. This can happen
when a component calls setState inside useEffect, but useEffect either doesn't
have a dependency array, or one of the dependencies changes on every render.
```

> Slot irmão: **F8-S16** cobre o outro bug da F8-S14 (500 no
> `/api/leads?search`). Pode ser implementado em paralelo (escopos disjuntos).

## Causa raiz (confirmada por leitura)

`apps/web/src/components/comboboxes/SimulationSelect.tsx:69-75`:

```ts
React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    onChange('', null); // ← chama callback do parent
  }
}, [leadId, onChange]); // ← onChange é função inline do parent
```

Parent (`CreditAnalysisForm`) passa `onChange={(id, sim) => { ... }}` inline —
nova referência a cada render. Sequência do loop:

1. `leadId === ''` (estado inicial).
2. useEffect dispara → `setSelectedSimulation(null)` + `onChange('', null)`.
3. Parent re-render (callback do form).
4. Parent passa nova função `onChange` (literal inline).
5. useEffect detecta `onChange` mudou → dispara de novo → loop.

## Objetivo

`SimulationSelect` não dispara o warning "Maximum update depth exceeded" em
nenhum cenário (lead null, lead selecionado, troca de lead, clear de lead).

## Escopo

### 1. `apps/web/src/components/comboboxes/SimulationSelect.tsx`

Aplicar uma das duas soluções:

**Opção A (recomendada — padrão `latest ref`)**: usar `useRef` para o callback,
sair da dep list.

```ts
const onChangeRef = React.useRef(onChange);
React.useEffect(() => {
  onChangeRef.current = onChange;
});

React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    onChangeRef.current('', null);
  }
}, [leadId]);
```

**Opção B**: só chamar `onChange` quando `value` ainda não é vazio (idempotente):

```ts
React.useEffect(() => {
  if (!leadId) {
    setSelectedSimulation(null);
    if (value) onChange('', null); // só notifica se ainda havia valor
  }
}, [leadId, value, onChange]);
```

Opção B é mais segura: após a primeira chamada, `value` ficaria vazio (parent
zerou) e o effect não chama mais. Decidir qual usar baseado no padrão já
adotado no resto do código `comboboxes/`.

### 2. Auditar `LeadCombobox.tsx` e `CityCombobox.tsx`

Mesmo padrão de useEffect com callback de parent em deps. Procurar
`useEffect` que chame `onChange()` dentro do corpo e tenha `onChange` em deps.
Se houver, aplicar a mesma correção. Linha 109-115 do `LeadCombobox.tsx` tem
`useEffect(... , [value])` — não loop, mas confirmar.

## Fora de escopo

- Não refatorar a UI dos comboboxes (visual está OK).
- Não trocar `useQuery` por outro mecanismo.
- Não mexer no backend (slot F8-S16 cobre o 500).
- Não tocar em outros componentes além dos três comboboxes.

## Arquivos permitidos

- `apps/web/src/components/comboboxes/SimulationSelect.tsx`
- `apps/web/src/components/comboboxes/LeadCombobox.tsx`
- `apps/web/src/components/comboboxes/CityCombobox.tsx`

## Arquivos proibidos

- `apps/api/**` (backend é F8-S16)
- `packages/shared-schemas/**`
- Qualquer arquivo fora dos três comboboxes.

## Definition of Done

- [ ] Loop em `SimulationSelect` corrigido (warning some no console em todos os
      fluxos: lead null, lead selecionado, troca de lead, clear via "X").
- [ ] `LeadCombobox` e `CityCombobox` auditados — se tinham mesmo bug,
      corrigidos. Se não tinham, nota no PR explicando por quê.
- [ ] `pnpm --filter @elemento/web typecheck` verde.
- [ ] `pnpm --filter @elemento/web lint --max-warnings 0` verde.
- [ ] PR descreve passos manuais de validação: - Abrir credit-analyses → "Nova análise" → console limpo. - Selecionar lead, ver simulações carregarem sem warning. - Trocar de lead → simulações resetam sem warning. - Clicar no "X" do SimulationSelect → reseta sem warning.

## Validação

```powershell
pnpm --filter @elemento/web typecheck
```

```powershell
pnpm --filter @elemento/web lint
```

## Notas

- Bug origem: F8-S14 (PR #159).
- Lição: comboboxes que recebem callback do parent + `useEffect` com side-effect
  no callback precisam de `useRef` (latest ref pattern) ou gate por estado
  interno (`value`).
- Slot irmão F8-S16 cobre o 500 do backend — pode ser implementado em paralelo.
