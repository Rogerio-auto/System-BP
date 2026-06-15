---
id: F5-S16
title: Frontend cobrança — anexar/visualizar boleto na parcela (upload PDF + URL + linha/PIX)
phase: F5
task_ref: docs/05-modulos-funcionais.md#cobranca-boleto
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T18:01:10Z
completed_at: null
pr_url: null
depends_on: [F5-S13]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/18-design-system.md
docs_required: true
docs_audience: [agente, gestor]
docs_artifacts:
  - docs/help/guias/cobranca/anexar-boleto-ui.mdx
---

# F5-S16 — Frontend: boleto na parcela

## Objetivo

UI para anexar/visualizar o boleto de uma parcela na tela de cobrança, batendo no contrato de F5-S13.
Sem isso, anexar boleto só é possível via API/importação.

## Escopo (`apps/web/src/features/billing/`)

- `PaymentDuesPage.tsx`: por linha de parcela, indicador de boleto (📎 anexado / vazio) + ação "Boleto".
- Novo `components/BoletoModal.tsx`:
  - Dois modos (tabs): **Upload PDF** (drag-drop) ou **Referência** (URL + linha digitável + PIX copia-e-cola).
  - Visualização do boleto anexado (link/preview) + ação remover.
  - Validação de mime/tamanho; feedback de erro do backend (allowlist de host, gate off, etc.).
- `schemas.ts`/`api.ts`/`hooks/useBilling.ts`: endpoints `POST`/`DELETE /payment-dues/:id/boleto` (multipart e json).
- Gate `billing.boleto.enabled` (UI): se off, esconder a ação com tooltip; banner reutilizável (`BillingGatedBanner`) se aplicável.
- **Design System (lei):** tokens; modal segue profundidade/hover canônicos.

## Fora de escopo

- Backend (F5-S13).
- Envio (worker, F5-S14).

## Arquivos permitidos

```
apps/web/src/features/billing/PaymentDuesPage.tsx
apps/web/src/features/billing/components/BoletoModal.tsx
apps/web/src/features/billing/schemas.ts
apps/web/src/features/billing/api.ts
apps/web/src/features/billing/hooks/useBilling.ts
apps/web/src/features/billing/__tests__/billing.test.ts
docs/help/guias/cobranca/anexar-boleto-ui.mdx
```

## Definition of Done

- [ ] Indicador de boleto na lista de parcelas
- [ ] `BoletoModal` com modos upload e referência + visualização + remover
- [ ] Validação de mime/tamanho + tratamento de erros do backend
- [ ] Schema front alinhado ao contrato real do backend
- [ ] Gate `billing.boleto.enabled` na UI
- [ ] Design System aplicado (tokens, sem hex hardcoded)
- [ ] Doc `docs/help/guias/cobranca/anexar-boleto-ui.mdx`
- [ ] Testes: abrir modal, upload, referência, remover, gate off esconde ação

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- billing
```

## Notas de implementação

- Ver memória "Drift de contrato front×API" e "Roteador/nav vivo do web" (App.tsx é o roteador real) — ler o contrato Zod real de F5-S13 antes de montar o modal.
