---
id: F18-S10
title: Frontend — NewLeadModal campos PJ + email obrigatório + personal_email agente (Onda 2 item 4)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#a2--lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F18-S09]
blocks: []
labels: [frontend, leads, form]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S10 — Frontend: NewLeadModal campos PJ + email obrigatório

## Objetivo

Tornar email obrigatório no cadastro manual, adicionar seção "Pessoa Jurídica" com CNPJ e razão social, tratar erros de email interno/duplicado e guiar o agente a cadastrar seu email pessoal.

## Contexto

Item 4 (Onda 2). Backend (F18-S09) valida e rejeita. Frontend precisa: (1) exibir os novos campos, (2) tratar as mensagens de erro específicas, (3) guiar o agente a registrar `personal_email` se não tiver cadastrado.

## Escopo (faz)

### `NewLeadModal.tsx`

- Campo **email**: tornar `required` (já era opcional no form). Mostrar hint: "Use o email do cliente, não o seu email pessoal."
- Seção **"Pessoa Jurídica (opcional)"** (collapsible ou toggle "Lead é PJ?"):
  - Campo **CNPJ** com máscara `XX.XXX.XXX/XXXX-XX` — input text masked; envia string de 14 dígitos.
  - Campo **Razão Social** — text input, opcional.
- Tratamento de erros inline:
  - `LEAD_EMAIL_INTERNAL` (422): "Este email pertence a um usuário interno. Informe o email real do cliente."
  - `LEAD_EMAIL_DUPLICATE` (409): "Este email já está cadastrado nesta organização."
  - `INVALID_CNPJ` (422): "CNPJ inválido. Verifique os dígitos informados."

### Prompt de `personal_email` do agente

- Na primeira abertura do `NewLeadModal` (ou num banner persistente no header se `user.personal_email` for null): banner/tooltip "Cadastre seu e-mail pessoal para proteger seus dados de contato" com link/botão que abre `PersonalEmailModal.tsx`.
- `PersonalEmailModal.tsx` — modal simples com campo de email, chama `PATCH /api/users/me/personal-email`.

## Fora de escopo (NÃO faz)

- Backend de validação (F18-S09).
- Obrigatoriedade de `personal_email` bloqueante no 1º login (evolução posterior — aqui só o prompt não-bloqueante).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/NewLeadModal.tsx`
- `apps/web/src/features/crm/PersonalEmailModal.tsx`
- `apps/web/src/features/crm/hooks.ts`
- `apps/web/src/features/crm/api.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`
- `apps/web/src/features/crm/CrmDetailPage.tsx`
- `apps/web/src/features/crm/CrmListPage.tsx`

## Contratos de entrada

- `LeadCreateSchema.cnpj` e `.legal_name` (F18-S08/S09).
- `PATCH /api/users/me/personal-email` (F18-S09).
- Códigos de erro: `LEAD_EMAIL_INTERNAL`, `LEAD_EMAIL_DUPLICATE`, `INVALID_CNPJ`.

## Definition of Done

- [ ] Email required no NewLeadModal.
- [ ] Campos CNPJ (com máscara) e Razão Social no form.
- [ ] Erros inline para os 3 casos.
- [ ] Banner/prompt de `personal_email` quando `user.personal_email === null`.
- [ ] `PersonalEmailModal` funcional.
- [ ] DS aplicado (tokens, sem hex).
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia `NewLeadModal.tsx` completo antes de editar.
- Máscara CNPJ: use a lib de mask existente no projeto ou implemente com `onInput` simples: replace `/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/` → `$1.$2.$3/$4-$5`. Envie só os dígitos ao backend.
- O campo email já existe — só altere o `required` e adicione hint.
- Banner de `personal_email`: verificar `useAuthStore` para acessar `user.personal_email`.
