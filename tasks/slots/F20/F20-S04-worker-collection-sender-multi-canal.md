---
id: F20-S04
title: Worker — collection-sender e collection-scheduler: multi-canal via tabela channels
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: in-progress
priority: high
estimated_size: L
agent_id: null
claimed_at: 2026-06-17T05:09:06Z
completed_at: null
pr_url: null
depends_on: [F20-S01, F20-S02]
blocks: []
labels: [backend, worker, cobranca, multi-canal, whatsapp]
source_docs: []
docs_required: false
---

# F20-S04 — Worker: collection-sender + collection-scheduler multi-canal

## Objetivo

Migrar `collection-sender.ts` para resolver credenciais WhatsApp da tabela `channels` em
vez das variáveis de ambiente. Migrar `collection-scheduler.ts` para atribuir `channel_id`
ao job no momento da criação. Espelho exato do que F20-S03 fez para followup.

## Contexto

`collection-sender.ts` hoje faz `new MetaWhatsAppClient()` sem argumentos na linha ~1644,
lendo credenciais do env. O arquivo tem ~1700 linhas e inclui lógica de re-upload de
boleto (PDF) via `MetaWhatsAppClient.uploadMedia()` — ambas as chamadas precisam ser
migradas para usar as credenciais do banco.

O `collection-sender` usa `MetaWhatsAppClient` em dois pontos:

1. `sendWithMetaClient`: envio do template WhatsApp
2. `uploadBoletoPdf` (ou similar): upload do PDF do boleto para a Meta antes do envio

Ambos os pontos devem receber as credenciais do canal resolvido (mesmo objeto `ResolvedChannel`).

## Escopo (faz)

### `apps/api/src/workers/collection-scheduler.ts`

Ao inserir o job, adicionar `channelId` (mesmo padrão de F20-S03):

```ts
const defaultChannel = await resolveChannelForSend(db, rule.organizationId, rule.channelId).catch(() => null);
const channelIdToAssign = defaultChannel?.channelId ?? null;

.values({
  // ...
  channelId: channelIdToAssign,  // NOVO
  // ...
})
```

### `apps/api/src/workers/collection-sender.ts`

Substituir inicialização com env vars pelo padrão do F20-S02:

```ts
// REMOVER:
let metaClient: MetaWhatsAppClient | null = null;
try {
  metaClient = new MetaWhatsAppClient();
} catch {
  /* ... */
}

// ADICIONAR (dentro de processJob, após carregar o job):
const resolved = await resolveChannelForSend(db, job.organizationId, job.channelId).catch((err) => {
  log.error({ err, jobId: job.id }, 'collection.sender.channel_not_found');
  return null;
});

if (!resolved) {
  await markJobFailed(db, job.id, 'Nenhum canal WhatsApp ativo configurado para esta organização');
  return { status: 'failed' };
}

const metaClient = new MetaWhatsAppClient({
  accessToken: resolved.accessToken,
  phoneNumberId: resolved.phoneNumberId,
});
```

Para o upload de boleto PDF (`uploadMedia`), o `MetaWhatsAppClient` já usa
`this.phoneNumberId` e `this.accessToken` internamente — basta o objeto estar
inicializado com as credenciais corretas do canal (não precisa mudança adicional).

Atualizar assinaturas internas que recebem `metaClient: MetaWhatsAppClient | null`
para `metaClient: MetaWhatsAppClient`.

Adicionar import:

```ts
import { resolveChannelForSend } from '../modules/channels/channel-selection.service.js';
```

## Fora de escopo (NÃO faz)

- Nenhuma mudança no frontend
- Não migrar followup-sender (F20-S03)
- Não migrar billing/service.ts upload direto (F20-S05)
- Não remover env vars globais (F20-S07)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/collection-sender.ts`
- `apps/api/src/workers/collection-scheduler.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/followup-sender.ts`
- `apps/api/src/workers/followup-scheduler.ts`
- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/api/src/config/env.ts`

## Contratos de saída

- `collection-sender.ts` não usa `new MetaWhatsAppClient()` sem credenciais explícitas
- Upload de boleto PDF usa credenciais do canal resolvido (não env)
- Jobs históricos com `channel_id = NULL` tratados via fallback para canal padrão
- `pnpm typecheck` verde

## Definition of Done

- [ ] `collection-scheduler.ts`: insere `channelId` no job
- [ ] `collection-sender.ts`: usa `resolveChannelForSend` para credenciais de envio
- [ ] `collection-sender.ts`: upload de boleto (`uploadMedia`) usa credenciais do canal
- [ ] `new MetaWhatsAppClient()` sem args removido do collection-sender
- [ ] Jobs com `channel_id = NULL` não quebram (fallback gracioso)
- [ ] Job falha com razão clara se org sem canal ativo
- [ ] Logs com `channelId`, `channelName` — nunca `accessToken`
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- Ler `collection-sender.ts` completo antes de editar (~1700 linhas).
- Buscar TODOS os pontos onde `MetaWhatsAppClient` é instanciado ou onde `metaClient` é
  passado como argumento — pode haver mais de uma inicialização (ex: fallback de re-upload).
- O `processJob` function pode ter múltiplos caminhos de retry — certificar que todos
  recebem o mesmo `metaClient` resolvido (não reinstanciar a cada retry).
- `job.organizationId` precisa estar disponível no SELECT que carrega o job — verificar
  e adicionar ao SELECT se necessário.
- Reutilizar exatamente o mesmo padrão de F20-S03 — consistência entre workers é
  obrigatória para manutenção futura.
