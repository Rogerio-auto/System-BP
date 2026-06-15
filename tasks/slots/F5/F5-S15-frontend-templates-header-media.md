---
id: F5-S15
title: Frontend templates — seletor de header (texto/documento/imagem) + upload de amostra + preview
phase: F5
task_ref: docs/05-modulos-funcionais.md#cobranca-boleto
status: in-progress
priority: medium
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T13:13:19Z
completed_at: null
pr_url: null
depends_on: [F5-S12]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/18-design-system.md
docs_required: true
docs_audience: [admin]
docs_artifacts:
  - docs/help/guias/templates/template-com-anexo.mdx
---

# F5-S15 — Frontend: template com header de mídia

## Objetivo

Dar ao operador a UI para criar/editar templates com **header de mídia** (documento/imagem) ou texto,
incluindo upload da amostra e preview, batendo no contrato de F5-S12. Hoje o `TemplateForm` só tem body.

## Escopo (`apps/web/src/features/templates/`)

- `TemplateForm.tsx`: seletor `headerType` (none/text/document/image). Quando:
  - `text` → campo `headerText` (com validação anti-PII espelhando o backend).
  - `document`/`image` → upload da amostra (drag-drop, mime/tamanho validados) usado só na submissão.
- `TemplatePreview.tsx`: refletir o header (chip "📎 documento" / "🖼 imagem" / texto) acima do body.
- `schemas.ts` (front): espelhar os campos novos do backend (ler do contrato Zod real — não inventar casing).
- `api.ts`/`useTemplates.ts`: enviar `multipart` quando há amostra.
- Gate `templates.media.enabled` (camada UI): se off, esconder/desabilitar as opções de mídia com tooltip explicativo.
- **Design System (lei):** tokens de `docs/18-design-system.md`. Sem hex hardcoded; estados de upload seguem os 6 padrões de hover/profundidade.

## Fora de escopo

- Backend (F5-S12).
- UI de anexar boleto na parcela (F5-S16).

## Arquivos permitidos

```
apps/web/src/features/templates/components/TemplateForm.tsx
apps/web/src/features/templates/components/TemplatePreview.tsx
apps/web/src/features/templates/schemas.ts
apps/web/src/features/templates/api.ts
apps/web/src/features/templates/hooks/useTemplates.ts
apps/web/src/features/templates/__tests__/TemplateForm.test.tsx
docs/help/guias/templates/template-com-anexo.mdx
```

## Definition of Done

- [ ] Seletor de `headerType` + campos condicionais (headerText / upload de amostra)
- [ ] Upload com validação de mime/tamanho e feedback de erro
- [ ] Preview reflete o header
- [ ] Schema front alinhado ao contrato real do backend (casing/envelope)
- [ ] Gate `templates.media.enabled` na UI (esconde mídia se off)
- [ ] Design System aplicado (tokens, sem hex hardcoded)
- [ ] Doc `docs/help/guias/templates/template-com-anexo.mdx`
- [ ] Testes: seleção de header text/document, validação anti-PII no headerText, gate off esconde opções

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- templates
```

## Notas de implementação

- Ver memória "Drift de contrato front×API": ler o schema Zod real de F5-S12 antes de montar o form. Não assumir o shape.
