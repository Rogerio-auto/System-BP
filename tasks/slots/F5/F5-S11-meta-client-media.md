---
id: F5-S11
title: Cliente Meta — parâmetro de mídia no envio + upload /media + header de mídia no catálogo
phase: F5
task_ref: docs/07-integracoes-whatsapp-chatwoot.md#midia-boleto
status: done
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-13T17:29:12Z
completed_at: 2026-06-13T17:39:54Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/221
depends_on: [F5-S03, F5-S09, F5-S10]
blocks: [F5-S12, F5-S14]
labels: []
source_docs:
  - docs/07-integracoes-whatsapp-chatwoot.md
  - docs/10-seguranca-permissoes.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F5-S11 — Cliente Meta: mídia no envio, upload e header de catálogo

## Objetivo

Habilitar a **camada de cliente HTTP da Meta** para mídia, em três frentes que hoje não existem:

1. **Envio** (`MetaWhatsAppClient.sendTemplate`): suportar parâmetro de header do tipo
   `document`/`image` (link **ou** media id), além de `text`/`currency` já existentes.
2. **Upload** (`MetaWhatsAppClient.uploadMedia`): novo método `POST /{phone_number_id}/media`
   que recebe bytes + mime-type e devolve um media `id` — caminho LGPD-preferido para o boleto
   (evita expor URL pública com PII).
3. **Catálogo** (`MetaTemplatesClient.submitTemplate`): suportar componente `HEADER` com
   `format: DOCUMENT|IMAGE` + `example.header_handle`, e um helper para subir a **amostra**
   do header de mídia (resumable upload via App ID) que produz o `header_handle`.

Sem isso, F5-S12 (templates com header) e F5-S14 (sender anexa boleto) não têm como falar com a Meta.

## Contexto (estado atual confirmado)

- `integrations/meta-whatsapp/types.ts`: `TemplateParameter = text | currency`. `TemplateHeaderComponent` existe mas **não há parâmetro de documento/imagem**. `sendTemplate` repassa `components` cru — basta os tipos novos e nenhum tratamento especial no corpo.
- `integrations/meta-whatsapp/client.ts`: só `sendTemplate`. Sem upload de mídia.
- `modules/templates/metaClient.ts`: `MetaTemplateComponent = { type, text }`. `submitTemplate` não suporta `format` nem `example`.

## Escopo

### 1. Parâmetros de mídia no envio (`meta-whatsapp/types.ts` + `client.ts`)

- Novos tipos:
  ```ts
  interface TemplateDocumentParameter {
    type: 'document';
    document: { link?: string; id?: string; filename?: string };
  }
  interface TemplateImageParameter {
    type: 'image';
    image: { link?: string; id?: string };
  }
  ```
  Estender `TemplateParameter` (ou criar `TemplateMediaParameter`) e permitir em `TemplateHeaderComponent.parameters`.
- Invariante validada: exatamente um de `link`/`id` presente (XOR). `sendTemplate` continua repassando `components` — sem novo branch, mas com guarda defensiva.
- **LGPD §8.3:** `link`/`id`/`filename` **nunca** em logs. Manter o padrão `to_hash`. Se logar contexto de header, logar apenas `header_type` e `has_media: true`.

### 2. `MetaWhatsAppClient.uploadMedia()`

```ts
async uploadMedia(params: { bytes: Buffer; mimeType: string; filename?: string }): Promise<{ mediaId: string }>
```

- `POST {GRAPH}/{phone_number_id}/media` (multipart/form-data: `file`, `type`, `messaging_product=whatsapp`).
- Reusa retry/backoff/timeout existentes. Sem retry em 4xx (exceto 429).
- Sanitiza erros (nunca vaza token). Nunca loga bytes/filename.

### 3. Header de mídia no catálogo (`templates/metaClient.ts`)

- `MetaTemplateComponent` ganha `format?: 'TEXT'|'DOCUMENT'|'IMAGE'|'VIDEO'` e `example?: { header_handle?: string[] }`.
- `submitTemplate` aceita um HEADER de mídia (format + example.header_handle).
- Novo helper `uploadSampleForTemplate(bytes, mimeType)` → faz o **resumable upload** (App ID,
  `POST {GRAPH}/{app_id}/uploads` → `POST {GRAPH}/{upload_id}` com os bytes) e retorna o `header_handle`.
  - Adicionar `META_APP_ID` ao `envSchema` (`apps/api/src/config/env.ts`, optional) — necessário para o resumable upload da amostra.

## Fora de escopo

- Persistência/colunas (já em F5-S10).
- Lógica de qual boleto enviar / quando (F5-S14).
- CRUD/Zod do módulo templates (F5-S12).

## Arquivos permitidos

```
apps/api/src/integrations/meta-whatsapp/types.ts
apps/api/src/integrations/meta-whatsapp/client.ts
apps/api/src/integrations/meta-whatsapp/__tests__/client.test.ts
apps/api/src/modules/templates/metaClient.ts
apps/api/src/modules/templates/__tests__/metaClient.test.ts
apps/api/src/config/env.ts
.env.example
docs/07-integracoes-whatsapp-chatwoot.md
```

## Definition of Done

- [ ] `TemplateDocumentParameter`/`TemplateImageParameter` + XOR link/id validado
- [ ] `sendTemplate` envia header de mídia corretamente (teste com mock HTTP cobrindo `id` e `link`)
- [ ] `uploadMedia()` implementado com retry/timeout + erros sanitizados
- [ ] `submitTemplate` suporta HEADER `format` + `example.header_handle`
- [ ] `uploadSampleForTemplate()` (resumable upload) retorna `header_handle`
- [ ] `META_APP_ID` no `envSchema` (optional) + `.env.example`
- [ ] **LGPD:** nenhum log de `link`/`id`/`filename`/bytes; token nunca logado; testes asseguram redação
- [ ] doc 07 `#midia-boleto` atualizado com o fluxo de upload + parâmetro de header
- [ ] Testes de cliente (envio mídia, upload, submit header) com `fetch` mockado

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- meta-whatsapp
pnpm --filter @elemento/api test -- templates/metaClient
```

## Notas de implementação

- **Dois uploads diferentes, não confundir:**
  - `uploadMedia` (Cloud API, por `phone_number_id`) → media `id` para **enviar** uma mensagem. Expira ~30 dias.
  - `uploadSampleForTemplate` (resumable, por `app_id`) → `header_handle` para **registrar** o template. É só uma amostra; não é o boleto real.
- Manter os dois clientes separados (envio vs catálogo) conforme F5-S03/F5-S09. Não fundir.
- Versão da Graph API: manter `v20.0` como nos clientes atuais.
