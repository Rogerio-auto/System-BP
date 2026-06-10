---
id: F5-S10
title: Schema — header de mídia em whatsapp_templates + campos de boleto em payment_dues + flags
phase: F5
task_ref: docs/07-integracoes-whatsapp-chatwoot.md#midia-boleto
status: available
priority: high
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F5-S01, F5-S06]
blocks: [F5-S11, F5-S12, F5-S13, F5-S14]
labels: [lgpd-impact]
source_docs:
  - docs/03-modelo-dados.md
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/09-feature-flags.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F5-S10 — Schema de mídia em templates + boleto na parcela + flags

## Objetivo

Abrir as colunas necessárias para enviar **boleto** (documento) numa cobrança via WhatsApp,
usando o caminho oficial da Meta: **template com header de mídia** (`DOCUMENT`/`IMAGE`).
Hoje `whatsapp_templates` só tem `body` texto e `payment_dues` não tem nenhum campo de boleto —
sem essas colunas nenhuma das camadas acima (Meta client, templates, sender, frontend) consegue ser construída.

Este slot é **somente schema + migration + flags**. Nenhuma lógica de envio/upload (isso é F5-S11..S14).

## Contexto (estado atual confirmado)

- `whatsapp_templates` (F5-S01): `name`, `category`, `language`, `body`, `variables[]`, `status`. Sem header de mídia.
- `payment_dues` (F5-S06): `contract_reference`, `installment_number`, `due_date`, `amount`, `status`, `paid_at`, `origin`. **Zero campos de boleto.**
- F5-S09 deixou explícito: "Templates de mídia (imagem/vídeo/documento) — MVP só texto; flag `templates.media.enabled=disabled`" — esta flag nunca foi seedada. Este slot a materializa.
- Decisão de produto (2026-06-10): boleto é **importado/anexado** (gerado pelo sistema do Banco do Povo). Sem integração bancária/PSP. Armazenamos a **referência** do boleto, não geramos cobrança.

## Escopo

### 1. `whatsapp_templates` — header de mídia

Adicionar colunas (todas com default que preserva o comportamento atual = template só-texto):

- `header_type text NOT NULL DEFAULT 'none'` com enum `['none','text','document','image','video']`.
  - `none` → template sem header (comportamento atual).
  - `text` → header de texto (pode ter 1 variável).
  - `document`/`image`/`video` → header de mídia (preenchido no envio com `link` ou media `id`).
- `header_text text` — conteúdo do header quando `header_type='text'` (placeholders `{{1}}` permitidos). NULL caso contrário.
- `header_handle text` — **media handle** retornado pela Meta no upload da amostra na submissão do template de mídia (necessário para `POST /message_templates`). NULL para `none`/`text`. Preenchido por F5-S12.

Check constraint: se `header_type IN ('document','image','video')` então o template é de mídia
(o `header_handle` pode estar NULL até a submissão — não forçar NOT NULL aqui).
Validação semântica fica no Zod do módulo (F5-S12), não no banco.

### 2. `payment_dues` — referência de boleto

Adicionar colunas (todas nullable — parcela pode não ter boleto):

- `boleto_url text` — URL do PDF do boleto. **Deve ser uma URL controlada pelo controlador** (Banco do Povo) e, idealmente, assinada/curta. Nunca uma URL pública permanente com PII. Usada como `document.link` no envio.
- `boleto_media_id text` — media id da Meta quando o arquivo foi enviado via `POST /media` (caminho LGPD-preferido: evita expor URL). Preenchido por F5-S13/S14.
- `boleto_media_expires_at timestamptz` — validade do `boleto_media_id` (Meta expira media em ~30 dias). Worker re-faz upload se expirado (F5-S14).
- `boleto_digitable_line text` — linha digitável (código de barras). Dado financeiro; pode ir como texto no body como fallback.
- `pix_copia_cola text` — payload PIX copia-e-cola (BR Code). Idem.
- `boleto_filename text` — nome amigável do arquivo exibido no WhatsApp (ex: `boleto-parcela-3.pdf`).
- `boleto_attached_at timestamptz` — quando o boleto foi anexado (auditoria).

Índice parcial `idx_payment_dues_with_boleto` em `(status, due_date) WHERE boleto_url IS NOT NULL OR boleto_media_id IS NOT NULL` — suporta o scanner do sender para parcelas com boleto.

### 3. Feature flags (seed idempotente em `db/seeds/featureFlags.ts` + migration)

- `templates.media.enabled` (default `disabled`) — gate de templates com header de mídia (UI + API + submit).
- `billing.boleto.enabled` (default `disabled`) — gate de anexar/enviar boleto na cobrança (UI + API + worker).
  - Dependência operacional documentada: só habilitar após `billing.enabled` e `templates.media.enabled`.

## Fora de escopo

- Cliente Meta (envio/upload/catálogo) → **F5-S11**.
- CRUD de header no módulo templates → **F5-S12**.
- Endpoint de anexar boleto + import adapter → **F5-S13**.
- Wiring do sender → **F5-S14**.
- Geração de boleto via banco/PSP (decisão de produto: fora de escopo, boleto é importado/anexado).
- Criptografia do PDF em repouso: não armazenamos bytes do PDF neste design (guardamos URL/`media_id`). Ver nota LGPD.

## Arquivos permitidos

```
apps/api/src/db/schema/whatsappTemplates.ts
apps/api/src/db/schema/paymentDues.ts
apps/api/src/db/schema/__tests__/whatsappTemplates.test.ts
apps/api/src/db/schema/__tests__/paymentDues.test.ts
apps/api/src/db/migrations/0050_media_header_boleto.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/seeds/featureFlags.ts
docs/17-lgpd-protecao-dados.md
docs/07-integracoes-whatsapp-chatwoot.md
```

> Nota: ajustar o número da migration (`0050_`) para o próximo livre no `_journal.json` no momento do claim.

## Definition of Done

- [ ] Colunas de header de mídia em `whatsapp_templates` (enum + defaults preservam template só-texto)
- [ ] Colunas de boleto em `payment_dues` (todas nullable) + índice parcial
- [ ] Migration gerada/escrita com entry correspondente em `_journal.json` (`slot.py check-migrations` verde)
- [ ] Flags `templates.media.enabled` e `billing.boleto.enabled` seedadas em `disabled` (idempotente)
- [ ] **LGPD (doc 17):** seção atualizada — boleto contém PII (nome, CPF, endereço); `boleto_url` deve ser controlada/assinada; `pino.redact` cobre `boleto_url`, `boleto_digitable_line`, `pix_copia_cola`; outbox nunca carrega esses campos; retenção alinhada à da parcela (5 anos); RoPA atualizado com a nova finalidade "envio de boleto"
- [ ] doc 07 ganha subseção `#midia-boleto` descrevendo o fluxo (header de mídia + parâmetro document)
- [ ] Testes de schema (colunas, defaults, enum, constraints, índice)

## Validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- paymentDues
pnpm --filter @elemento/api test -- whatsappTemplates
```

## Notas de implementação

- **Por que não armazenar o PDF (bytes) no banco?** O boleto contém CPF — armazenar bytes brutos exigiria cifragem em repouso (doc 17). O design escolhido guarda apenas referência (`boleto_url` controlada/assinada ou `boleto_media_id` da Meta), o que mantém a superfície de PII mínima e evita infra de object storage no MVP. Registrar essa decisão na descrição do PR (DPIA leve, doc 17 §11).
- `header_handle` é específico da submissão (catálogo) e `boleto_media_id` é específico do envio — são coisas diferentes (uma é amostra do template, a outra é o boleto real do cliente). Não confundir.
- O enum `header_type` inclui `video` por completude do contrato Meta, mas o MVP só exercita `document`/`image`/`text`/`none`.
