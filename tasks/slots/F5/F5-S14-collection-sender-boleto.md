---
id: F5-S14
title: collection-sender — anexar header de boleto no envio de cobrança (re-upload + fallback)
phase: F5
task_ref: docs/05-modulos-funcionais.md#cobranca-boleto
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-15T03:48:27Z
completed_at: null
pr_url: null
depends_on: [F5-S11, F5-S13]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/09-feature-flags.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience: [gestor]
docs_artifacts:
  - docs/help/guias/cobranca/cobranca-com-boleto.mdx
---

# F5-S14 — Enviar boleto na cobrança

## Objetivo

Fazer o worker `collection-sender` **anexar o boleto** (header de mídia) quando o template da régua
tem `header_type` de documento/imagem e a parcela tem boleto. Hoje o worker monta só
`[{type:'body', parameters}]` (variáveis texto) e nunca anexa nada.

## Contexto (estado atual confirmado)

- `buildCollectionSendParams` (collection-sender.ts) só gera o componente `body`.
- `loadCollectionJobContext` carrega `due` mas **não seleciona** as novas colunas de boleto (F5-S10) — precisa estender o select.
- O template já chega no contexto (`ctx.template`); após F5-S10/S12 ele tem `header_type`/`header_handle`.

## Escopo (somente `workers/collection-sender.ts`)

1. **Carregar boleto:** estender o select de `payment_dues` em `loadCollectionJobContext` para incluir
   `boleto_url`, `boleto_media_id`, `boleto_media_expires_at`, `boleto_digitable_line`, `pix_copia_cola`, `boleto_filename`.
2. **Montar header de mídia** em `buildCollectionSendParams` quando `ctx.template.header_type ∈ (document,image)`:
   - Preferir `boleto_media_id` se presente **e não expirado** → header `document`/`image` por `id`.
   - Senão, se `boleto_media_id` expirado e `boleto_url` presente → **re-upload**: baixar de `boleto_url` e `uploadMedia` (F5-S11) para obter novo `id` (atualizar a parcela com o novo id/expiração na mesma transação de sucesso).
   - Senão, se só `boleto_url` → header por `link`.
3. **Fallback `boleto_missing`:** se o template é de mídia mas a parcela não tem boleto (nem url nem id):
   - marcar job `failed` com `last_error='boleto_missing'`, emitir `billing.collection_failed` (terminal), **não** chamar a Meta. Decisão registrada: cobrança que exige boleto não cai para texto silenciosamente.
4. **Gate `billing.boleto.enabled`:** se desligado, ignorar o header de boleto (envia só o body, como hoje) — o boleto é aditivo e gated.
5. **LGPD §8.3/§8.5:** nunca logar `boleto_url`/`media_id`/`filename`/linha/pix; logs só com IDs + `has_boleto: true/false`. Outbox sem esses campos.

## Fora de escopo

- Endpoint/import de boleto (F5-S13).
- Cliente Meta (F5-S11).
- followup-sender (este slot é só cobrança).

## Arquivos permitidos

```
apps/api/src/workers/collection-sender.ts
apps/api/src/workers/__tests__/collection-sender.test.ts
docs/help/guias/cobranca/cobranca-com-boleto.mdx
```

## Definition of Done

- [ ] `loadCollectionJobContext` seleciona as colunas de boleto
- [ ] `buildCollectionSendParams` monta header `document`/`image` por `id` (preferido) ou `link`
- [ ] Re-upload quando `boleto_media_id` expirou (atualiza a parcela com novo id/expiração na tx de sucesso)
- [ ] Fallback `boleto_missing` (job failed terminal, sem chamar Meta) quando template de mídia e parcela sem boleto
- [ ] Gate `billing.boleto.enabled` respeitado (boleto é aditivo)
- [ ] **LGPD:** logs/outbox só com IDs + flags; checklist §14.2 no PR; label `lgpd-impact`
- [ ] Doc `docs/help/guias/cobranca/cobranca-com-boleto.mdx`
- [ ] Testes: envio por media_id, envio por link, re-upload em expiração, boleto_missing, gate off (envia só body), dry-run

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- collection-sender
```

## Notas de implementação

- O re-upload exige um `fetch` de `boleto_url` dentro do worker — aplicar timeout e allowlist de host (mesma de F5-S13). Tratar falha de download como erro retryável do job (não terminal), distinto de `boleto_missing`.
- `filename` exibido no WhatsApp deve ser amigável (ex: `boleto-{contract}-p{installment}.pdf`) — derivar se `boleto_filename` ausente. Não incluir CPF no filename.
