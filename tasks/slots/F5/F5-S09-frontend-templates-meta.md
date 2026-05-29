---
id: F5-S09
title: Frontend templates WhatsApp + sync Meta Cloud + webhook de status
phase: F5
task_ref: T5.9
status: in-progress
priority: medium
estimated_size: L
agent_id: frontend-engineer
claimed_at: 2026-05-29T23:49:02Z
completed_at: null
pr_url: null
depends_on: [F5-S01, F5-S03, F1-S08, F1-S20, F8-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/09-feature-flags.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
  - docs/18-design-system.md
---

# F5-S09 — Frontend templates WhatsApp + sync Meta Cloud + webhook de status

## Objetivo

Telas administrativas para gerir o catálogo de templates de WhatsApp Meta — criar, editar, listar e
**sincronizar com a Cloud API da Meta** (submissão para aprovação e recepção de status via webhook).
Sem essa peça, templates só existem como linhas em `whatsapp_templates` (seed manual). Com ela, o
operador cria/edita pela UI, dispara `POST /message_templates` na Meta e o status (`pending` →
`approved`/`rejected`) é refletido automaticamente via webhook `template_status_update`.

Tela visível mesmo com `followup.enabled=disabled`, com banner indicando que envios estão off — o
gerenciamento de templates é independente da régua (templates podem ser cadastrados antes do
go-live de follow-up/cobrança).

## Escopo

- **Backend — módulo `apps/api/src/modules/templates/`:**

  - Endpoints:
    ```
    GET    /api/templates                            — lista (filtros: status, category, language)
    GET    /api/templates/:id                        — detalhe
    POST   /api/templates                            — cria local + submete na Meta (status=pending)
    PATCH  /api/templates/:id                        — edita local (apenas templates pending/rejected)
    DELETE /api/templates/:id                        — soft delete (status=paused; não remove da Meta)
    POST   /api/templates/:id/sync                   — força refetch do status na Meta (idempotente)
    POST   /api/templates/sync-all                   — sync batch (rate-limited; gated por flag)
    ```
  - **Webhook receiver** em `apps/api/src/modules/whatsapp/webhookController.ts` (estender o webhook
    existente da Meta): tratar payload `template_status_update` → atualizar `whatsapp_templates.status`
    - emitir outbox `templates.status_changed`.
  - **Cliente Meta Cloud** em `apps/api/src/modules/templates/metaClient.ts` (separado do cliente
    de envio criado em F5-S03):
    - `submitTemplate(payload)` → `POST /{waba_id}/message_templates`
    - `getTemplate(meta_template_id)` → `GET /{meta_template_id}`
    - `listTemplates()` → `GET /{waba_id}/message_templates` (para sync-all)
    - Retry com `tenacity`-equivalente (exponential backoff) e respeito a rate-limit headers
  - Permissões novas: `templates:read`, `templates:write`, `templates:sync`, `templates:delete`
    — seedadas via migration `0042_seed_template_permissions.sql` (idempotente).
  - **LGPD:** o body do template pode conter `{{variables}}` mas o conteúdo do template em si NÃO é
    PII (são placeholders); validar via Zod que `body` não contém CPF/email/telefone hardcoded
    (regex defensivo) — bloquear submit se detectado.
  - **Auditoria:** toda mutação registra em `audit_log` (actor, action, template_id, diff).
  - **Idempotência:** `POST /api/templates` e `POST /api/templates/:id/sync` aceitam header
    `Idempotency-Key` (padrão F1-S08).

- **Frontend — `apps/web/src/features/templates/`:**

  - Página `/admin/templates` — lista paginada com:
    - Colunas: nome, categoria, idioma, status (badge), última sync, ações
    - Filtros: status (pending/approved/rejected/paused), categoria
    - Botão "Sincronizar tudo" (gated por permissão + flag)
  - Página `/admin/templates/new` — form de criação:
    - Campos: `name` (slug interno), `category` (utility/marketing/authentication),
      `language` (pt_BR default), `body` (textarea com syntax highlight de `{{var}}`),
      `variables` (lista derivada do body, editável)
    - Preview do template renderizado com variáveis de exemplo
    - Validação Zod estrita (mesma do backend)
  - Página `/admin/templates/:id` — detalhe + edit (só permite editar se status ∈ pending/rejected):
    - Timeline de mudanças de status (do webhook)
    - Botão "Reenviar para aprovação" (após edit)
    - Histórico de uso (count de mensagens enviadas via esse template — opcional, gated)
  - Componentes: `TemplateStatusBadge`, `TemplateVariablesInput`, `TemplatePreview`, `TemplateForm`
  - Hooks: `useTemplates`, `useTemplate`, `useCreateTemplate`, `useUpdateTemplate`, `useSyncTemplate`
  - Entrar no Hub de Configurações (F8-S08) como aba **"Templates WhatsApp"**
  - Adicionar em `apps/web/src/app/navigation.ts` sob seção de Configurações ou top-level
    (decisão final na review de UX — default: tab no Hub)
  - **Design System (lei):** tokens de `docs/18-design-system.md`. Status badges usam paleta
    semântica (verde aprovado, amarelo pending, vermelho rejected, cinza paused). Sem hex hardcoded.

## Fora de escopo

- Editor visual rich-text (slot futuro — MVP usa textarea com placeholders `{{var}}`)
- Versionamento de templates (slot futuro — edit cria nova revisão na Meta, histórico fica no audit)
- Templates de mídia (imagem/vídeo/documento) — MVP só texto; flag `templates.media.enabled=disabled`
- A/B test de templates (pós-MVP)
- Métricas de performance por template no dashboard (slot futuro, gated)

## Arquivos permitidos

```
apps/api/src/modules/templates/repository.ts
apps/api/src/modules/templates/service.ts
apps/api/src/modules/templates/controller.ts
apps/api/src/modules/templates/schemas.ts
apps/api/src/modules/templates/routes.ts
apps/api/src/modules/templates/metaClient.ts
apps/api/src/modules/templates/index.ts
apps/api/src/modules/templates/__tests__/templates.routes.test.ts
apps/api/src/modules/templates/__tests__/metaClient.test.ts
apps/api/src/modules/whatsapp/webhookController.ts
apps/api/src/modules/whatsapp/__tests__/webhookController.test.ts
apps/api/src/app.ts
apps/api/src/db/migrations/0042_seed_template_permissions.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seed/permissions.ts
apps/web/src/features/templates/TemplatesListPage.tsx
apps/web/src/features/templates/TemplateDetailPage.tsx
apps/web/src/features/templates/TemplateFormPage.tsx
apps/web/src/features/templates/components/TemplateForm.tsx
apps/web/src/features/templates/components/TemplateStatusBadge.tsx
apps/web/src/features/templates/components/TemplateVariablesInput.tsx
apps/web/src/features/templates/components/TemplatePreview.tsx
apps/web/src/features/templates/hooks/useTemplates.ts
apps/web/src/features/templates/api.ts
apps/web/src/features/templates/schemas.ts
apps/web/src/features/templates/__tests__/TemplateForm.test.tsx
apps/web/src/app/router.tsx
apps/web/src/app/navigation.ts
```

## Definition of Done

- [ ] 7 rotas backend implementadas com Zod e RBAC (4 permissões novas)
- [ ] Webhook `template_status_update` parseado e idempotente (replay seguro)
- [ ] Cliente Meta Cloud (`metaClient.ts`) com retry/backoff e timeout configurável
- [ ] Migration 0042 seeda 4 permissões + atribuições para roles padrão, idempotente
- [ ] 3 páginas frontend (lista, detalhe, form) integradas no Hub de Configurações
- [ ] Item de navegação adicionado em `navigation.ts`
- [ ] Banner explicativo quando `followup.enabled=disabled` (templates podem ser cadastrados, envio off)
- [ ] Validação Zod estrita anti-PII no body (regex CPF/email/telefone bloqueia submit)
- [ ] Auditoria em toda mutação (`audit_log` com actor + diff)
- [ ] Idempotência em `POST /api/templates` e `/sync` via `Idempotency-Key`
- [ ] Design System aplicado (tokens, sem hex hardcoded, status badges semânticos)
- [ ] Testes backend: CRUD + RBAC + webhook (fixtures de payload Meta) + metaClient (mock HTTP)
- [ ] Testes frontend: form de criação (validação variáveis), lista (filtros), badge de status

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- templates
pnpm --filter @elemento/api test -- whatsapp/webhook
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- templates
```

## Notas de implementação

- O cliente Meta de **envio de mensagens** (criado em F5-S03) e o cliente de **gestão de templates**
  (criado aqui) compartilham auth (token WABA) mas têm responsabilidades distintas — manter em
  arquivos separados (`metaClient.ts` de templates ≠ `whatsappClient.ts` de envio).
- O webhook `template_status_update` chega na **mesma URL** dos webhooks de mensagens (Meta usa
  um único endpoint). O handler atual em `apps/api/src/modules/whatsapp/webhookController.ts`
  precisa ser estendido para distinguir `messages` vs `message_template_status_update` no payload.
- Sync-all deve respeitar rate-limit da Meta (header `X-Business-Use-Case-Usage`); usar
  semáforo em memória ou tabela `meta_rate_limit_state` (slot futuro se necessário).
- Considerar feature flag `templates.sync_all.enabled=disabled` no MVP para evitar burst acidental.
