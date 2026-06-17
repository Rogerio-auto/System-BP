---
id: F20-S06
title: Backend — templates/metaClient: gestão de templates HSM via canal do banco
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: available
priority: medium
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F20-S02, F20-S05]
blocks: [F20-S07]
labels: [backend, templates, multi-canal, whatsapp]
source_docs: []
docs_required: false
---

# F20-S06 — Backend: templates/metaClient multi-canal

## Objetivo

Migrar `modules/templates/metaClient.ts` (o cliente de gestão de templates HSM da Meta)
para usar credenciais e WABA ID vindos da tabela `channels` em vez das variáveis de
ambiente `META_WHATSAPP_ACCESS_TOKEN`, `META_WABA_ID` e `META_WHATSAPP_PHONE_NUMBER_ID`.

## Contexto

`modules/templates/metaClient.ts` tem ~330 linhas e gerencia templates HSM (criar,
listar, verificar status) via Meta Business API. É diferente do `MetaWhatsAppClient`
(que envia mensagens) — usa o WABA ID (não phoneNumberId) como identificador.

Hoje usa fallback em cascata:

```ts
const resolvedToken = options.accessToken ?? env.META_WHATSAPP_ACCESS_TOKEN;
const resolvedWabaId = options.wabaId ?? env.META_WABA_ID ?? env.META_WHATSAPP_PHONE_NUMBER_ID;
```

O `wabaId` está disponível em `channels.wabaId` — mas hoje nenhuma rota de templates
passou esse campo. Após a migração, o caller (controller de templates) deve resolver o
canal e passar `{ accessToken, wabaId }` explicitamente.

## Escopo (faz)

### `apps/api/src/modules/templates/metaClient.ts`

Modificar o `MetaTemplatesClient` para:

1. **Remover o fallback para env vars** no constructor:

```ts
// ANTES:
const resolvedToken = options.accessToken ?? env.META_WHATSAPP_ACCESS_TOKEN;
const resolvedWabaId = options.wabaId ?? env.META_WABA_ID ?? env.META_WHATSAPP_PHONE_NUMBER_ID;

// DEPOIS:
const resolvedToken = options.accessToken;
const resolvedWabaId = options.wabaId;

if (!resolvedToken || !resolvedWabaId) {
  throw new ExternalServiceError(
    'Canal WhatsApp sem credenciais de gestão de templates — ' +
      'verifique access_token e waba_id no canal configurado',
  );
}
```

2. **Garantir que `MetaTemplatesClientOptions` exige** `accessToken` e `wabaId` (não mais opcionais):

```ts
interface MetaTemplatesClientOptions {
  accessToken: string; // obrigatório — vem do canal
  wabaId: string; // obrigatório — waba_id do canal
  metaAppId?: string; // opcional — meta_app_id do canal (para resumable upload)
}
```

### `apps/api/src/modules/templates/service.ts` (ou controller)

Wherever `MetaTemplatesClient` is instantiated, resolve credentials from DB first:

```ts
import { resolveChannelForSend } from '../channels/channel-selection.service.js';

// Antes de instanciar:
const resolved = await resolveChannelForSend(db, organizationId, null); // usa canal padrão
if (!resolved.wabaId) {
  throw new ExternalServiceError(
    'Canal padrão não tem WABA ID configurado — gestão de templates indisponível',
  );
}

const templatesClient = new MetaTemplatesClient({
  accessToken: resolved.accessToken,
  wabaId: resolved.wabaId,
  metaAppId: channel.metaAppId ?? undefined,
});
```

Verificar todos os pontos de instanciação de `MetaTemplatesClient` com grep e migrar
cada um.

## Fora de escopo (NÃO faz)

- Não migrar `MetaWhatsAppClient` (envio de mensagens) — já feito em F20-S03/S04/S05
- Não remover env vars do `env.ts` (F20-S07)
- Não alterar lógica de criação/listagem de templates

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/templates/metaClient.ts`
- `apps/api/src/modules/templates/service.ts`
- `apps/api/src/modules/templates/controller.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/integrations/meta-whatsapp/client.ts`
- `apps/api/src/workers/**`
- `apps/web/**`
- `apps/api/src/config/env.ts`

## Contratos de saída

- `MetaTemplatesClient` não usa env vars — exige `accessToken` e `wabaId` explícitos
- Caller resolve credenciais via `resolveChannelForSend` antes de instanciar
- `ExternalServiceError` claro se canal não tiver `wabaId` configurado
- `pnpm typecheck` verde

## Definition of Done

- [ ] `MetaTemplatesClient` constructor sem fallback para env vars
- [ ] `MetaTemplatesClientOptions.accessToken` e `.wabaId` obrigatórios
- [ ] Todos os callers de `MetaTemplatesClient` resolvem credenciais via canal do banco
- [ ] `ExternalServiceError` com mensagem acionável se `wabaId` ausente no canal
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- `resolved.wabaId` pode ser null — `channels.wabaId` é nullable no schema. Verificar e
  lançar erro claro se null (a gestão de templates requer WABA ID).
- `channel.metaAppId` é necessário para "resumable upload" de templates com mídia —
  expor via `ResolvedChannel` se ainda não está lá (adicionar ao tipo em F20-S02 se necessário).
- Fazer grep por `new MetaTemplatesClient` para garantir que todos os pontos de
  instanciação são cobertos.
- `env.META_WABA_ID` e `env.META_WHATSAPP_PHONE_NUMBER_ID` (como fallback de wabaId)
  não devem mais aparecer neste arquivo após a migração.
