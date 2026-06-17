---
id: F20-S03
title: Worker — followup-sender e followup-scheduler: multi-canal via tabela channels
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: done
priority: high
estimated_size: L
agent_id: null
claimed_at: null
completed_at: 2026-06-17T05:25:19Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/302
depends_on: [F20-S01, F20-S02]
blocks: []
labels: [backend, worker, followup, multi-canal, whatsapp]
source_docs: []
docs_required: false
---
# F20-S03 — Worker: followup-sender + followup-scheduler multi-canal

## Objetivo

Migrar `followup-sender.ts` para resolver credenciais WhatsApp da tabela `channels` em
vez das variáveis de ambiente. Migrar `followup-scheduler.ts` para atribuir `channel_id`
ao job no momento da criação (herdado da regra ou resolvido via fallback para o canal
padrão da org).

## Contexto

`followup-sender.ts` hoje faz `new MetaWhatsAppClient()` que lê
`META_WHATSAPP_ACCESS_TOKEN` e `META_WHATSAPP_PHONE_NUMBER_ID` do env — hardcoded para
um único canal global. O `MetaWhatsAppClient` já aceita `options: { accessToken, phoneNumberId }`
no constructor — basta passar as credenciais resolvidas do banco.

Fluxo pós-migração:

1. **Scheduler** cria o job e escreve `channel_id` = `rule.channelId ?? defaultChannelForOrg`
2. **Sender** lê `job.channelId`, chama `resolveChannelForSend(db, org, job.channelId)`,
   instancia `new MetaWhatsAppClient({ accessToken, phoneNumberId })` e envia

Compatibilidade retroativa: jobs com `channel_id = NULL` (históricos) → sender chama
`resolveChannelForSend(db, org, null)` que retorna o canal padrão — sem quebra.

## Escopo (faz)

### `apps/api/src/workers/followup-scheduler.ts`

Ao inserir o job (`database.insert(followupJobs).values({...})`), adicionar `channelId`:

```ts
// Antes de entrar no loop de leads, resolver o channel_id da regra:
const defaultChannel = await resolveChannelForSend(db, rule.organizationId, rule.channelId).catch(() => null);
const channelIdToAssign = defaultChannel?.channelId ?? null;

// No .values({...}):
.values({
  organizationId: lead.organizationId,
  leadId: lead.leadId,
  ruleId: rule.id,
  channelId: channelIdToAssign,  // NOVO
  scheduledAt,
  status: 'scheduled',
  attemptCount: 0,
  idempotencyKey,
})
```

Se `resolveChannelForSend` falhar (org sem canal ativo), logar warning e continuar sem
`channelId` — o sender vai tentar resolver novamente no momento do envio.

### `apps/api/src/workers/followup-sender.ts`

Substituir a inicialização com env vars:

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
  log.error({ err, jobId: job.id }, 'followup.sender.channel_not_found');
  return null;
});

if (!resolved) {
  // Marcar job como failed com razão clara
  await markJobFailed(db, job.id, 'Nenhum canal WhatsApp ativo configurado para esta organização');
  return { status: 'failed' };
}

const metaClient = new MetaWhatsAppClient({
  accessToken: resolved.accessToken,
  phoneNumberId: resolved.phoneNumberId,
});
```

Atualizar as assinaturas internas que recebem `metaClient: MetaWhatsAppClient | null` para
`metaClient: MetaWhatsAppClient` (remover null — agora é resolvido antes ou o job falha).

Atualizar os imports:

```ts
import { resolveChannelForSend } from '../modules/channels/channel-selection.service.js';
```

Remover import e uso de `env.META_WHATSAPP_ACCESS_TOKEN` / `env.META_WHATSAPP_PHONE_NUMBER_ID`
no contexto do followup-sender (manter apenas se `env.ts` ainda precisar para outros módulos).

## Fora de escopo (NÃO faz)

- Nenhuma mudança no frontend
- Não migrar collection-sender (F20-S04)
- Não migrar simulations/billing (F20-S05)
- Não remover env vars do `env.ts` global (F20-S07)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/workers/followup-sender.ts`
- `apps/api/src/workers/followup-scheduler.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/collection-sender.ts`
- `apps/api/src/workers/collection-scheduler.ts`
- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/api/src/config/env.ts`

## Contratos de saída

- `followup-sender.ts` não usa `new MetaWhatsAppClient()` sem credenciais explícitas
- Jobs com `channel_id = NULL` (históricos) são tratados via fallback para canal padrão
- Jobs falham com mensagem clara se a org não tiver canal ativo
- `pnpm typecheck` verde

## Definition of Done

- [ ] `followup-scheduler.ts`: insere `channelId` no job (de `rule.channelId` ou default da org)
- [ ] `followup-sender.ts`: usa `resolveChannelForSend` para carregar credenciais
- [ ] `new MetaWhatsAppClient()` (sem args) removido do followup-sender
- [ ] Jobs com `channel_id = NULL` não quebram — sender faz fallback para canal padrão
- [ ] Job falha com `reason` claro se org sem canal ativo (não exceção não tratada)
- [ ] Logs usam `channelId`, `channelName` — nunca `accessToken`
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] Testar manualmente: job agendado → enviado com credenciais do banco (não do env)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- Ler `apps/api/src/workers/followup-sender.ts` completo antes de editar — o arquivo tem ~950 linhas.
- As funções internas `buildSendParams`, `sendWithMetaClient` recebem `metaClient` como parâmetro.
  Após a refatoração, `metaClient` será sempre não-null na chamada dessas funções.
- `job.organizationId` está disponível? Verificar o SELECT que carrega o job no sender.
  Se não, adicionar ao SELECT.
- Não remover o try/catch geral — apenas substituir a inicialização do MetaWhatsAppClient.
- `resolveChannelForSend` deve ser chamada uma vez por job (não por mensagem).
- Manter `// dry-run` paths intactos — eles devem continuar funcionando sem canal real.
