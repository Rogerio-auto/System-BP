---
id: F20-S02
title: Backend — Channel Selection Service (resolução de canal para workers e módulos)
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: review
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-17T04:14:58Z
completed_at: 2026-06-17T04:26:37Z
pr_url: null
depends_on: [F20-S01]
blocks: [F20-S03, F20-S04, F20-S05, F20-S06]
labels: [backend, multi-canal, whatsapp, channels]
source_docs: []
docs_required: false
---

# F20-S02 — Backend: Channel Selection Service

## Objetivo

Criar o serviço utilitário central `channel-selection.service.ts` que encapsula toda a
lógica de "dado uma org (e opcionalmente um channelId explícito), retorne as credenciais
decifradas prontas para instanciar o MetaWhatsAppClient". Todos os workers e módulos da
F20 dependem deste serviço — ele é a fonte única de verdade para resolução de canal.

## Contexto

O padrão já existe e funciona em `livechat-outbound.ts`:

1. Busca canal por ID no banco
2. Busca secrets na tabela `channel_secrets`
3. Decifra `access_token_enc` com `decryptPii`
4. Passa `{ accessToken, phoneNumberId }` ao cliente HTTP

Este slot extrai esse padrão em uma função reutilizável e acrescenta a lógica de fallback:

- Se `channelId` é explícito → usar esse canal
- Se `channelId` é null → buscar canal com `is_default = true` na org
- Se nenhum `is_default` → usar o primeiro canal ativo da org
- Se nenhum canal ativo → lançar `ExternalServiceError` com mensagem acionável

## Escopo (faz)

### Novo arquivo: `apps/api/src/modules/channels/channel-selection.service.ts`

```ts
export interface ResolvedChannel {
  channelId: string;
  accessToken: string; // decifrado, pronto para uso
  phoneNumberId: string; // ID técnico Meta
  wabaId: string | null; // para gestão de templates
  channelName: string; // nome amigável (para logs)
}

/**
 * Resolve as credenciais de envio para uma organização.
 *
 * Prioridade: explicitChannelId > is_default = true > primeiro canal ativo.
 * Lança ExternalServiceError se nenhum canal ativo existir para a org.
 */
export async function resolveChannelForSend(
  db: DrizzleDb,
  organizationId: string,
  explicitChannelId?: string | null,
): Promise<ResolvedChannel>;
```

Internamente:

1. Se `explicitChannelId` → `WHERE id = explicit AND organization_id = org AND deleted_at IS NULL AND is_active = true`
2. Senão → `WHERE organization_id = org AND deleted_at IS NULL AND is_active = true ORDER BY is_default DESC, created_at ASC LIMIT 1`
3. Busca secrets: `SELECT * FROM channel_secrets WHERE channel_id = channel.id LIMIT 1`
4. Decifra `access_token_enc` com `decryptPii` (importar de `../../utils/encryption.js` ou onde estiver)
5. Retorna `ResolvedChannel`
6. Lança `ExternalServiceError('Nenhum canal WhatsApp ativo configurado para esta organização')` se não encontrar

### Novo arquivo: `apps/api/src/modules/channels/channel-selection.repository.ts`

Isola as queries do banco:

```ts
export async function findActiveChannelForOrg(
  db: DrizzleDb,
  organizationId: string,
  channelId?: string | null,
): Promise<typeof channels.$inferSelect | null>;

export async function findChannelSecrets(
  db: DrizzleDb,
  channelId: string,
): Promise<typeof channelSecrets.$inferSelect | null>;
```

### Exportar de `apps/api/src/modules/channels/index.ts`

Se o arquivo não existir, criar. Exportar `resolveChannelForSend` e o repositório.

## Fora de escopo (NÃO faz)

- Nenhuma mudança em workers (F20-S03/S04/S05)
- Nenhum endpoint HTTP novo (canais já têm CRUD)
- Nenhuma mudança no frontend

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/channels/channel-selection.service.ts` (NOVO)
- `apps/api/src/modules/channels/channel-selection.repository.ts` (NOVO)
- `apps/api/src/modules/channels/index.ts` (criar ou atualizar exports)

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**`
- `apps/api/src/modules/billing/**`
- `apps/api/src/modules/simulations/**`
- `apps/web/**`

## Contratos de saída

- `resolveChannelForSend(db, organizationId, explicitChannelId?)` exportada e tipada
- Testes unitários básicos cobrindo: explicit id, fallback is_default, fallback first-active, erro sem canal
- `pnpm typecheck` verde

## Definition of Done

- [ ] `resolveChannelForSend` exportada de `modules/channels/`
- [ ] Prioridade de resolução: explicit → is_default → first-active → ExternalServiceError
- [ ] `decryptPii` usado para `access_token_enc` (LGPD: token nunca em plaintext no DB)
- [ ] Logs estruturados com `channelId` e `channelName` (nunca `accessToken`)
- [ ] Tipo `ResolvedChannel` exportado (F20-S03/S04/S05 dependem dele)
- [ ] `pnpm --filter @elemento/api typecheck` verde
- [ ] `pnpm --filter @elemento/api test` verde (testes unitários da seleção)

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test --testPathPattern=channel-selection
```

## Notas para o agente

- Verificar onde `decryptPii` está exportada: `grep -rn "export.*decryptPii\|export.*decryptField" apps/api/src/`
- Verificar onde `ExternalServiceError` está definida: `grep -rn "class ExternalServiceError" apps/api/src/`
- `channelSecrets.accessTokenEnc` é `bytea` — a função de decriptação espera `Buffer`
- LGPD: nunca logar `accessToken` — logar apenas `channelId` e `channelName`
- Usar `organizationId` em todo lookup para evitar vazamento cross-tenant (RBAC)
- O campo `phone_number_id` na tabela `channels` é `phoneNumberId` no schema Drizzle — confirmar o nome exato
