---
id: F5-S13
title: Cobrança — anexar boleto à parcela (endpoint + import) com RBAC, auditoria e LGPD
phase: F5
task_ref: docs/05-modulos-funcionais.md#cobranca-boleto
status: done
priority: high
estimated_size: L
agent_id: null
claimed_at: null
completed_at: 2026-06-14T17:35:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/224
depends_on: [F5-S10, F5-S11, F5-S08]
blocks: [F5-S14, F5-S16]
labels: [lgpd-impact]
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/08-importacoes.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: true
docs_audience: [agente, gestor]
docs_artifacts:
  - docs/help/guias/cobranca/anexar-boleto.mdx
---

# F5-S13 — Anexar boleto à parcela

## Objetivo

Permitir que uma parcela (`payment_dues`) tenha um **boleto** anexado — via upload manual de PDF
ou via importação em lote — preenchendo as colunas criadas em F5-S10. É o que torna possível o
envio do boleto na cobrança (F5-S14). Boleto é **importado/anexado** (não gerado): sem integração bancária.

## Escopo

### Endpoint de anexar/atualizar boleto (`modules/billing/`)

```
POST   /api/billing/payment-dues/:id/boleto      — anexa/atualiza o boleto da parcela
DELETE /api/billing/payment-dues/:id/boleto      — remove o boleto anexado
```

Corpo aceita **um** de dois modos:

1. **Upload de arquivo** (`multipart/form-data`, PDF/JPG/PNG): o service chama
   `MetaWhatsAppClient.uploadMedia` (F5-S11) → guarda `boleto_media_id` + `boleto_media_expires_at`
   (≈30 dias) + `boleto_filename`. **Não persistimos os bytes** (decisão LGPD de F5-S10).
2. **Referência** (`application/json`): `boletoUrl` (URL controlada/assinada), `digitableLine`, `pixCopiaCola`, `filename`.

Validações:

- `boletoUrl`, quando presente, deve passar por allowlist de host (config) — bloquear URLs públicas arbitrárias para reduzir exposição de PII.
- mime-type e tamanho do upload validados.
- City scope + RBAC: nova permissão `billing:boleto:write` (seed idempotente). Gestor regional só anexa em parcelas da sua cidade.
- Gate `billing.boleto.enabled` (camada API).
- **Idempotency-Key** no POST (padrão F1-S08).
- **Auditoria** (`audit_log`) — sem PII: apenas `payment_due_id`, modo (`upload`/`reference`), `has_media`.
- **Outbox** opcional `billing.boleto_attached` (sem PII — só IDs). Avaliar necessidade; se emitir, seguir padrão dos demais eventos billing.

### Importação em lote (`services/imports/paymentDuesAdapter.ts`)

- Mapear colunas opcionais da planilha: `boleto_url`, `linha_digitavel`, `pix_copia_cola`.
  (Upload de PDF em massa fica fora — importação traz a **URL/linha/PIX**, não bytes.)
- Aplicar a mesma allowlist de host à `boleto_url` importada.

## Fora de escopo

- Frontend (F5-S16).
- Envio do boleto no WhatsApp (F5-S14).
- Geração de boleto (banco/PSP) — fora de escopo do produto.

## Arquivos permitidos

```
apps/api/src/modules/billing/schemas.ts
apps/api/src/modules/billing/service.ts
apps/api/src/modules/billing/controller.ts
apps/api/src/modules/billing/routes.ts
apps/api/src/modules/billing/repository.ts
apps/api/src/modules/billing/__tests__/billing.routes.test.ts
apps/api/src/services/imports/paymentDuesAdapter.ts
apps/api/src/services/imports/__tests__/paymentDuesAdapter.test.ts
apps/api/src/db/migrations/0051_seed_billing_boleto_permission.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seed/permissions.ts
docs/help/guias/cobranca/anexar-boleto.mdx
```

> Nota: ajustar o número da migration para o próximo livre no claim.

## Definition of Done

- [ ] `POST`/`DELETE /payment-dues/:id/boleto` com os dois modos (upload e referência)
- [ ] Upload chama `uploadMedia` e persiste `boleto_media_id` + expiração + filename (sem guardar bytes)
- [ ] Allowlist de host para `boletoUrl` (endpoint + importação)
- [ ] Permissão `billing:boleto:write` seedada (migration idempotente) + city scope aplicado
- [ ] Gate `billing.boleto.enabled` na camada API
- [ ] Idempotency-Key + auditoria sem PII
- [ ] paymentDuesAdapter mapeia `boleto_url`/`linha_digitavel`/`pix_copia_cola`
- [ ] **Checklist LGPD §14.2** preenchido no PR + label `lgpd-impact` + `pino.redact` cobre os novos campos
- [ ] Doc de ajuda `docs/help/guias/cobranca/anexar-boleto.mdx`
- [ ] Testes: upload, referência, allowlist bloqueando URL fora da lista, RBAC/city scope, gate off, import com colunas de boleto

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- billing
pnpm --filter @elemento/api test -- paymentDuesAdapter
```

## Notas de implementação

- O `boleto_media_id` pode expirar antes do disparo. F5-S14 lida com re-upload; aqui basta gravar `boleto_media_expires_at` honestamente a partir da resposta da Meta (ou agora + 30d defensivo).
- Se a parcela já está `paid`/`cancelled`, recusar anexar boleto (não faz sentido cobrar).
