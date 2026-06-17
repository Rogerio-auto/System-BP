---
id: F20-S05
title: Backend — simulations/service + billing/service: multi-canal via tabela channels
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-17T05:08:24Z
completed_at: 2026-06-17T05:43:58Z
pr_url: null
depends_on: [F20-S01, F20-S02]
blocks: [F20-S07]
labels: [backend, simulations, billing, multi-canal, whatsapp]
source_docs: []
docs_required: false
---

# F20-S05 — Backend: simulations/service + billing/service multi-canal

## Objetivo

Migrar `modules/simulations/service.ts` e `modules/billing/service.ts` para resolverem
credenciais WhatsApp da tabela `channels` em vez das variáveis de ambiente. Diferente dos
workers (que operam de forma assíncrona), esses módulos são chamados diretamente por
request HTTP — o `channelId` pode vir no body da requisição ou ser resolvido via padrão
da org.

## Contexto

### simulations/service.ts

A função `sendSimulation` (linha ~643) instancia `new MetaWhatsAppClient()` sem argumentos.
O `channelId` virá opcionalmente no body da requisição POST — se não informado, usar
`resolveChannelForSend(db, org, null)` para pegar o canal padrão.

### billing/service.ts

A função de upload de boleto (linha ~568) instancia `new MetaWhatsAppClient()` sem
argumentos para chamar `uploadMedia`. O `channelId` precisa ser passado como parâmetro
de contexto — vindo do job de cobrança ou do contexto da requisição.

## Escopo (faz)

### `apps/api/src/modules/simulations/service.ts`

1. Adicionar campo `channelId?: string | null` ao tipo de parâmetros de `sendSimulation`
2. Substituir inicialização com env vars:

```ts
// REMOVER:
let metaClient: MetaWhatsAppClient;
try {
  metaClient = new MetaWhatsAppClient();
} catch (err) {
  throw new ExternalServiceError('...');
}

// SUBSTITUIR por:
const resolved = await resolveChannelForSend(db, organizationId, params.channelId ?? null);
const metaClient = new MetaWhatsAppClient({
  accessToken: resolved.accessToken,
  phoneNumberId: resolved.phoneNumberId,
});
```

3. Adicionar import de `resolveChannelForSend`
4. Gravar `channelId` em `credit_simulations.channelId` ao criar/atualizar a simulação

### `apps/api/src/modules/simulations/routes.ts`

Adicionar campo `channelId` opcional ao schema Zod da rota de disparo de simulação:

```ts
// No schema do body de disparo:
channelId: z.string().uuid().optional().nullable(),
```

Passar `channelId` do body para o service.

### `apps/api/src/modules/billing/service.ts`

1. Adicionar `channelId?: string | null` ao contexto de upload de boleto
2. Substituir `new MetaWhatsAppClient()` por resolução via banco:

```ts
const resolved = await resolveChannelForSend(db, organizationId, channelId ?? null);
const metaClient = new MetaWhatsAppClient({
  accessToken: resolved.accessToken,
  phoneNumberId: resolved.phoneNumberId,
});
```

3. O `channelId` de contexto virá do `collection_job.channelId` (quando chamado via worker)
   ou do request (quando chamado via HTTP direto).
4. Atualizar as assinaturas das funções afetadas para aceitar `channelId`.

## Fora de escopo (NÃO faz)

- Não migrar workers (F20-S03/S04)
- Não migrar templates/metaClient.ts (F20-S06)
- Não remover env vars globais (F20-S07)
- Não criar endpoints novos para canais

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/simulations/service.ts`
- `apps/api/src/modules/simulations/routes.ts`
- `apps/api/src/modules/simulations/controller.ts`
- `apps/api/src/modules/simulations/schemas.ts`
- `apps/api/src/modules/billing/service.ts`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**`
- `apps/api/src/modules/templates/**`
- `apps/web/**`
- `apps/api/src/config/env.ts`

## Contratos de saída

- `sendSimulation` aceita `channelId` opcional → usa canal do banco ou padrão da org
- Upload de boleto em billing/service usa credenciais do canal do banco
- `credit_simulations.channel_id` é gravado ao disparar simulação
- Schemas Zod atualizados para aceitar `channelId` opcional no request
- `pnpm typecheck` verde

## Definition of Done

- [ ] `simulations/service.ts`: `new MetaWhatsAppClient()` sem args removido
- [ ] `simulations/routes.ts`: schema aceita `channelId?: string (uuid)` opcional
- [ ] `credit_simulations.channel_id` gravado ao disparar (para auditoria)
- [ ] `billing/service.ts`: upload de boleto usa credenciais do canal
- [ ] `billing/service.ts`: `new MetaWhatsAppClient()` sem args removido
- [ ] ExternalServiceError com mensagem acionável se org sem canal ativo
- [ ] Logs com `channelId` — nunca `accessToken`
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
```

## Notas para o agente

- `organizationId` sempre disponível via `request.user.organizationId` no controller.
- Em `billing/service.ts`, rastrear de onde vem o `channelId` — pode ser de um
  `collection_job` (que já terá `channelId` após F20-S04) ou de um request direto.
- Em `simulations/service.ts`, a função `sendSimulation` recebe um objeto de parâmetros —
  verificar a interface atual antes de adicionar campos.
- Manter o comportamento de `// dry-run` e `// skip-if-not-configured` onde existirem —
  a diferença agora é que "não configurado" = "org sem canal ativo" (não "env var ausente").
- `resolveChannelForSend` lança `ExternalServiceError` se não encontrar canal — não é
  preciso um try/catch adicional; o error handler do Fastify converte para 502.
