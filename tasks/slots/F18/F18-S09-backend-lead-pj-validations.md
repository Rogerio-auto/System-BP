---
id: F18-S09
title: Backend — lead PJ validações + email blocklist (Onda 2 item 4)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#a2--lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-16T13:08:10Z
completed_at: null
pr_url: null
depends_on: [F18-S08]
blocks: [F18-S10]
labels: [backend, leads, validation, rbac]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---

# F18-S09 — Backend: lead PJ validações + email blocklist

## Objetivo

Validar CNPJ (formato), tornar email obrigatório no cadastro manual, garantir unicidade de email por org e bloquear emails internos (usuários da org) + email pessoal do agente.

## Contexto

Item 4 (Onda 2). Depende de F18-S08 para os campos existirem no DB e schema. Decisões:

- D2: unicidade por organização (índice único parcial já criado).
- D3: bloquear TODOS os emails internos da org + email pessoal registrado do agente.
- Email obrigatório apenas quando `source = 'manual'`.

## Escopo (faz)

### Validação condicional no LeadCreateSchema

- Em `packages/shared-schemas/src/leads.ts` OU no `service.ts` do módulo leads: adicionar `superRefine` que faz email obrigatório quando `source === 'manual'`.
- Validar CNPJ: strip não-dígitos, verificar 14 dígitos e dígitos verificadores (usar biblioteca ou implementar o algoritmo). Retornar `422 INVALID_CNPJ` se inválido.

### Bloqueio de email interno (service de criação de lead)

Em `apps/api/src/modules/leads/service.ts`, antes do INSERT:

1. Se `input.email` presente: buscar em `users` onde `organization_id = org_id AND (email = input.email OR personal_email = input.email)`.
2. Se encontrado: retornar `422 LEAD_EMAIL_INTERNAL` com mensagem "O email informado pertence a um usuário interno. Use o email do cliente."

### Unicidade de email

Tratar violação do índice `uq_leads_org_email_active` como `409 LEAD_EMAIL_DUPLICATE` (espelha o padrão de `LEAD_PHONE_DUPLICATE` existente).

### Persistência de CNPJ e legal_name

Em `apps/api/src/modules/leads/repository.ts`: incluir `cnpj` e `legalName` no INSERT e UPDATE.
Em `apps/api/src/modules/leads/service.ts`: passar os campos.

### Endpoint de personal_email do usuário (1º login)

- `PATCH /api/users/me/personal-email` (auth obrigatório): aceita `{ personal_email: string }`, valida formato email, garante unicidade por org. Persiste em `users.personal_email`.
- Rota em `apps/api/src/modules/users/routes.ts`.

## Fora de escopo (NÃO faz)

- UI (F18-S10).
- Fluxo de "cobrar email pessoal no 1º login" — a obrigatoriedade do cadastro é UI (F18-S10).

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/schemas.ts`
- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/users/service.ts`
- `apps/api/src/modules/users/repository.ts`
- `packages/shared-schemas/src/leads.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**`
- `apps/api/src/db/migrations/**`
- `apps/web/**`
- `apps/api/src/modules/leads/routes.ts`

## Definition of Done

- [ ] Email obrigatório ao criar lead com `source = 'manual'`.
- [ ] CNPJ validado (formato + dígitos verificadores).
- [ ] Email interno bloqueado com `422 LEAD_EMAIL_INTERNAL`.
- [ ] Unicidade: `409 LEAD_EMAIL_DUPLICATE` se duplicado.
- [ ] `cnpj` e `legal_name` persistidos no banco.
- [ ] `PATCH /api/users/me/personal-email` funcionando.
- [ ] Testes: email interno bloqueado, CNPJ inválido, email duplicado, sucesso PJ.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test -- leads` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- leads
```

## Notas para o agente

- Algoritmo CNPJ: 14 dígitos, dois dígitos verificadores pela regra dos pesos 5,4,3,2,9,8,7,6,5,4,3,2 e 6,5,4,3,2,9,8,7,6,5,4,3,2. Se preferir pacote externo, use `cnpj-cpf-check` ou similar (já pode existir no projeto — verifique `package.json`).
- Para buscar usuários internos: query em `users` pela tabela, filtrada por `organization_id` — não em `leads`.
- O `personal_email` do agente logado (`req.user.id`) deve ser consultado via `users.personalEmail`.
- Para `PATCH /api/users/me/personal-email`: o agente logado está em `req.user` (injetado pelo middleware de auth). Sem escopo de cidade extra.
