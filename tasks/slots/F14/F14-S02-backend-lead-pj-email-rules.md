---
id: F14-S02
title: Backend — lead PJ + email obrigatório no manual + unicidade + bloqueio interno
phase: F14
task_ref: null
status: blocked
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F14-S01]
blocks: [F14-S03, F14-S04]
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#a2-lead-pj-email-obrigatório-no-manual-unicidade-e-bloqueio-do-email-do-agente-item-4
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F14-S02 — Backend: lead PJ + regras de email

## Objetivo

Implementar no backend o cadastro PJ (CNPJ/razão social), o **email obrigatório apenas no cadastro manual**, a **unicidade de email por organização** e o **bloqueio de emails internos** da org.

## Contexto

Item 4 / Épico A.2. Decisões: D2 (email único por org), D3 (bloquear emails internos — `users.email` da org; cobrar email pessoal do agente vem no F14-S04). Depende do schema F14-S01 (colunas + índice único).

## Escopo (faz)

- `packages/shared-schemas/src/leads.ts`:
  - Adicionar `cnpj` (regex de CNPJ, opcional/nullable) e `legal_name` (opcional) ao `LeadCreateSchema`/`LeadUpdateSchema`.
  - **Email obrigatório quando `source === 'manual'`** via `superRefine` (mantém opcional para whatsapp/import/api/chatwoot).
  - Estender `LeadResponseSchema` com `cnpj` e `legal_name` (rebuild do shared-schemas — dist gitignored).
- `apps/api/src/modules/leads/service.ts`:
  - Persistir `cnpj`/`legalName`.
  - **Unicidade de email:** tratar violação do índice `uq_leads_org_email_active` (23505) → `LeadEmailDuplicateError` (409, code `LEAD_EMAIL_DUPLICATE`) — espelha o padrão de `LeadPhoneDuplicateError`.
  - **Bloqueio de email interno:** se o email informado bater com qualquer `users.email` da org → `422 LEAD_EMAIL_INTERNAL` ("Use o email do cliente, não um email interno"). Query helper no repository.
- `apps/api/src/modules/leads/repository.ts`: helper `isInternalEmail(db, orgId, email)` (consulta `users` por email na org).
- Testes de service + rota (positivo + negativo: duplicado, interno, manual-sem-email).

## Fora de escopo (NÃO faz)

- `users.personal_email` e bloqueio do email pessoal (F14-S04).
- Frontend do NewLeadModal (F14-S03).

## Arquivos permitidos (`files_allowed`)

- `packages/shared-schemas/src/leads.ts`
- `apps/api/src/modules/leads/service.ts`
- `apps/api/src/modules/leads/repository.ts`
- `apps/api/src/modules/leads/schemas.ts`
- `apps/api/src/modules/leads/__tests__/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/db/schema/**` (dono é F14-S01)
- `apps/web/**` (dono é F14-S03)
- `apps/api/src/db/schema/users.ts` (dono é F14-S04)

## Contratos de saída

- `LeadCreate` aceita `cnpj`, `legal_name`; email obrigatório no manual.
- Erros `409 LEAD_EMAIL_DUPLICATE` e `422 LEAD_EMAIL_INTERNAL` para o front (F14-S03) tratar.
- `LeadResponse` inclui `cnpj`, `legal_name`.

## Definition of Done

- [ ] Email obrigatório no `source=manual`; opcional nas demais origens
- [ ] Unicidade de email por org → 409 (não 500) com mensagem clara
- [ ] Bloqueio de email interno (qualquer `users.email` da org) → 422
- [ ] CNPJ/razão social persistidos e no response
- [ ] Testes positivo + negativo verdes
- [ ] `pnpm --filter @elemento/api typecheck && lint && test -- leads` verdes; shared-schemas rebuildado

## Comandos de validação

```powershell
pnpm --filter @elemento/shared-schemas build
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- leads
```

## Notas para o agente

- O canal interno (IA `getOrCreateLead`) NÃO usa `LeadCreateSchema` — o `superRefine` de email manual não o afeta. Confirmar.
- LGPD: CNPJ é texto claro (D1); ainda assim, não logar `email`/`cnpj` sem `pino.redact` (já cobre email; avaliar cnpj).
- Drift front×API (memória `feedback_parallel_contract_drift`): o front (F14-S03) lê o `LeadCreateSchema`/erros reais.
