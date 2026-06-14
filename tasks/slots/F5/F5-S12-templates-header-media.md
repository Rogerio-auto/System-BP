---
id: F5-S12
title: Módulo templates — header_type (texto/documento/imagem) no CRUD + submit de header de mídia
phase: F5
task_ref: docs/07-integracoes-whatsapp-chatwoot.md#midia-boleto
status: done
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-14T16:07:30Z
completed_at: 2026-06-14T16:23:45Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/223
depends_on: [F5-S10, F5-S11]
blocks: [F5-S15]
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/09-feature-flags.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F5-S12 — Templates com header de mídia (API)

## Objetivo

Permitir criar/editar templates com **header de mídia** (`document`/`image`) ou **header de texto**,
e submetê-los corretamente na Meta usando o cliente de catálogo (F5-S11). Hoje o módulo só conhece
templates de body texto; a coluna `header_type` (F5-S10) e o cliente (F5-S11) existem mas ninguém os usa.

## Escopo

### Schemas (`modules/templates/schemas.ts`)

- `TemplateCreateSchema`/`TemplateUpdateSchema`/`TemplateResponseSchema` ganham:
  - `headerType: enum('none','text','document','image','video')` default `none`.
  - `headerText: string.optional()` (obrigatório/permitido só quando `headerType='text'`; superRefine reaproveitando o DLP anti-PII já existente).
  - Validação cruzada (superRefine):
    - `headerType='text'` ⇒ `headerText` presente e sem PII bruta.
    - `headerType` de mídia ⇒ `headerText` ausente; exige amostra para submissão (ver service).
- Gate: criação/edição de template de mídia exige `templates.media.enabled` (camada API). Se desligado, 422/403 com mensagem clara.

### Service (`modules/templates/service.ts`)

- No create/resubmit:
  - `headerType='text'` → componente `HEADER` `format=TEXT` + `text`.
  - `headerType in (document,image,video)` → exige uma **amostra** (arquivo enviado no request ou referência), chama `uploadSampleForTemplate` (F5-S11) → `header_handle`, persiste em `whatsapp_templates.header_handle`, e inclui `HEADER` `format` + `example.header_handle` no `submitTemplate`.
- Auditoria em toda mutação (já é padrão do módulo) incluindo `header_type` no diff.
- LGPD: amostra é genérica (sem PII); validar mime-type/tamanho; nunca logar bytes.

### Controller/Routes

- `POST /api/templates` e `PATCH /api/templates/:id` aceitam os novos campos.
- Upload da amostra: aceitar `multipart/form-data` (ou URL de amostra) — escolher a opção mais simples e registrar no PR. Default sugerido: campo `sampleUpload` multipart opcional, validado por mime/tamanho.
- RBAC inalterado (`templates:write`). Idempotency-Key mantida.

## Fora de escopo

- Frontend (F5-S15).
- Envio real de mensagens com mídia (F5-S14).
- Botões de template (quick_reply/url) — slot futuro.

## Arquivos permitidos

```
apps/api/src/modules/templates/schemas.ts
apps/api/src/modules/templates/service.ts
apps/api/src/modules/templates/controller.ts
apps/api/src/modules/templates/routes.ts
apps/api/src/modules/templates/repository.ts
apps/api/src/modules/templates/__tests__/templates.routes.test.ts
```

## Definition of Done

- [ ] Schemas com `headerType`/`headerText` + validação cruzada + DLP anti-PII no headerText
- [ ] Service submete HEADER de texto e de mídia (com `header_handle`) corretamente
- [ ] `header_handle` persistido em `whatsapp_templates`
- [ ] Gate `templates.media.enabled` na camada API (bloqueia criar template de mídia se off)
- [ ] Auditoria inclui `header_type` no diff; Idempotency-Key mantida
- [ ] Validação de amostra (mime-type permitido: pdf/jpg/png; limite de tamanho)
- [ ] Testes: criar template texto-header, criar template document-header (mock upload), gate off → bloqueio, DLP no headerText

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- templates
```

## Notas de implementação

- Reaproveitar o `rejectPiiInTemplateBody` existente para `headerText`.
- Não permitir trocar `headerType` de um template já `approved` (Meta exige nova submissão) — só em `pending`/`rejected`, mesmo critério de edição já aplicado ao body.
