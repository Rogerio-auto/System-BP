---
id: F17-S11
title: Frontend — modal de criação de contrato
phase: F17
task_ref: null
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: 2026-06-16T05:10:38Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/254
depends_on: [F17-S02, F17-S03, F17-S06]
blocks: []
labels: [contracts, frontend, form]
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-e--contratos-boletos-e-renovação-item-5--épico
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
  - gestor
docs_artifacts:
  - docs/help/guias/contratos/criar-contrato.mdx
---

# F17-S11 — Frontend modal de criação de contrato

## Objetivo

Permitir que o operador crie um contrato diretamente pela aba Contratos, preenchendo um formulário com os dados do cliente, produto e condições financeiras.

## Contexto

A API `POST /api/contracts` (F17-S03) existe mas não tinha UI de criação. O status `draft` → `signed` existe, mas sem poder criar o contrato pela tela o fluxo estava incompleto. Este slot fecha esse gap.

## Escopo (faz)

- Botão **"Novo Contrato"** na `ContractsPage` (gate `contracts:write`).
- `ContractCreateModal.tsx` — modal com formulário React Hook Form + Zod (`ContractCreateSchema` de F17-S02):
  - **Cliente** — campo de busca/seleção: `GET /api/leads?status=closed_won&limit=50` para listar clientes convertidos; campo de texto com autocomplete; exibe nome + referência; armazena `customer_id` (campo `customer_id` do `LeadResponse` — já exposto após fix F17-S08)
  - **Referência do contrato** — `contract_reference`: sugestão auto-gerada pelo frontend no formato `BP-{ANO}-{5 dígitos random}` editável
  - **Produto** — select via `GET /api/credit-products` (lista de produtos ativos); armazena `product_id`; ao selecionar, preenche automaticamente `monthly_rate_snapshot` com a taxa da regra ativa do produto (`active_rule.monthly_rate`)
  - **Valor principal** — `principal_amount`: campo monetário (máscara BRL, envia como string `"5000.00"`)
  - **Prazo** — `term_months`: número inteiro 1–360 (meses)
  - **Taxa mensal** — `monthly_rate_snapshot`: editável mesmo após auto-preenchimento (override manual); exibido em % (ex: `"1.5"` = 1.5% a.m.); enviado como string decimal
  - **1ª parcela** — `first_due_date`: date picker (YYYY-MM-DD); opcional, pode ficar em branco
- Submissão via `POST /api/contracts`; ao criar com sucesso: fechar modal + invalidar `['contracts', 'list']` + abrir automaticamente a ficha do contrato criado (`ContractDetail`)
- Validação inline (mensagens embaixo do campo); botão de submit desabilitado enquanto `isPending`
- DS aplicado (modal `elev-5`, inputs com tokens, erro em `var(--danger)`)

## Fora de escopo (NÃO faz)

- Criação automática de `payment_dues` ao criar o contrato (parcelas são geradas pelo fluxo de simulação de crédito — outro épico)
- Edição de contrato existente (status `draft` → edição não está no escopo; apenas criação)
- Validação bancária de taxa/prazo (é snapshot informativo, sem cálculo de amortização aqui)

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/contracts/**`
- `docs/help/guias/contratos/criar-contrato.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/App.tsx`
- `apps/web/src/features/crm/**`
- `apps/web/src/features/billing/**`
- `packages/shared-schemas/**`

## Contratos de entrada

- `ContractCreateSchema` em `packages/shared-schemas/src/contracts.ts` (F17-S02) — já importado em `features/contracts/schemas.ts`
- `POST /api/contracts` (F17-S03) — já chamável via `api.ts` do módulo contracts
- `GET /api/leads?status=closed_won` — leads convertidos (customer com `customer_id` exposto após F17-S08 fix)
- `GET /api/credit-products` — lista de produtos com `active_rule.monthly_rate` disponível via `apps/web/src/lib/api/credit-products.ts`

## Contratos de saída

- Botão "Novo Contrato" + `ContractCreateModal` integrados na `ContractsPage`
- Hook `useCreateContract` exportado de `hooks.ts`

## Definition of Done

- [ ] Botão "Novo Contrato" visível apenas para quem tem `contracts:write`
- [ ] Formulário valida todos os campos com mensagem inline (Zod + RHF)
- [ ] Seleção de produto auto-preenche taxa mensal (editável)
- [ ] Submit cria contrato, fecha modal, abre ficha do contrato criado
- [ ] Estado de loading no botão submit durante `isPending`
- [ ] DS aplicado (sem hex hardcoded, tokens var(--...))
- [ ] Doc mdx `criar-contrato.mdx` com `<FeedbackWidget />` no rodapé
- [ ] `pnpm --filter @elemento/web typecheck && lint && test -- contracts` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- contracts
```

## Notas para o agente

- **Leia antes de editar:** `apps/web/src/features/contracts/ContractsPage.tsx`, `hooks.ts`, `api.ts`, `schemas.ts`, `index.ts` — todos foram criados em F17-S05/S06 e devem ser estendidos, não sobrescritos.
- **`customer_id` do lead:** após fix do F17-S08, `LeadResponse` expõe `customer_id: string | null`. Use esse campo para preencher `ContractCreateSchema.customer_id`. O campo de busca de cliente deve exibir o nome do lead mas enviar o `customer_id` (UUID da tabela `customers`). Se `customer_id` for null, desabilite a seleção desse lead.
- **Geração de referência:** `BP-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}` como sugestão inicial editável.
- **Taxa mensal:** o campo `active_rule` em `CreditProductResponse` tem `monthly_rate` como number (ex: `0.015` = 1.5%). Converta para string `"1.5"` ao exibir em % e para `"0.015"` ao enviar (verifique o formato esperado pela API lendo `ContractCreateSchema.monthly_rate_snapshot`).
- **Mdx:** evite `{#anchor}` e `{{texto}}` — quebram o manifest test. `<FeedbackWidget />` é injetado pelo layout, não inclua inline.
- O `ContractSignModal` já existe no módulo — siga o mesmo padrão de abertura/fechamento de modal.
