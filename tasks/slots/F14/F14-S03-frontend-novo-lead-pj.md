---
id: F14-S03
title: Frontend — NewLeadModal com PJ + email obrigatório
phase: F14
task_ref: null
status: blocked
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F14-S02]
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#a2-lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/crm/cadastro-pj.mdx
---

# F14-S03 — Frontend: NewLeadModal PJ + email obrigatório

## Objetivo

No cadastro manual de lead, tornar o **email obrigatório** e adicionar a seção de **Pessoa Jurídica** (CNPJ + razão social), tratando os erros de email duplicado e email interno.

## Contexto

Item 4 / Épico A.2. O `NewLeadModal` é o cadastro manual (`source='manual'`). Depende do backend F14-S02 (campos + erros 409/422).

## Escopo (faz)

- `NewLeadModal.tsx`:
  - Tornar o campo **E-mail `required`** (o modal é o cadastro manual).
  - Adicionar seção **"Pessoa Jurídica (opcional)"**: CNPJ (com máscara `00.000.000/0000-00`) e Razão social.
  - Tratar erros inline: `409 LEAD_EMAIL_DUPLICATE` → erro no campo email ("Já existe lead com este email"); `422 LEAD_EMAIL_INTERNAL` → erro no campo email ("Use o email do cliente, não um email interno").
- `hooks/crm/useCreateLead.ts`: mapear os novos códigos de erro para callbacks (espelhar `onDuplicatePhone`).
- Guia `docs/help/guias/crm/cadastro-pj.mdx`.

## Fora de escopo (NÃO faz)

- Backend (F14-S02). Fluxo de 1º login do agente (F14-S04).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/NewLeadModal.tsx`
- `apps/web/src/features/crm/__tests__/NewLeadModal.test.tsx`
- `apps/web/src/hooks/crm/useCreateLead.ts`
- `docs/help/guias/crm/cadastro-pj.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**` (consumir, não editar)

## Contratos de entrada

- `LeadCreateSchema` com `cnpj`/`legal_name` + email obrigatório no manual (F14-S02).
- Erros `409 LEAD_EMAIL_DUPLICATE` / `422 LEAD_EMAIL_INTERNAL`.

## Definition of Done

- [ ] Email obrigatório no modal; bloqueia submit sem email
- [ ] Campos CNPJ (máscara) + razão social, opcionais
- [ ] Erros de duplicado/interno exibidos inline no campo email
- [ ] `pnpm --filter @elemento/web typecheck && lint && test -- crm` verdes
- [ ] Guia `cadastro-pj.mdx` criado

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- crm
```

## Notas para o agente

- Reusar o componente `Input` do DS para CNPJ; máscara de CNPJ (não confundir com CPF).
- O `NewLeadModal` já valida via `zodResolver(LeadCreateSchema)` — os campos novos vêm do schema compartilhado.
