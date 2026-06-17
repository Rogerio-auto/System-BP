---
id: F20-S01
title: Schema — channel_id em followup_rules, followup_jobs, collection_rules, collection_jobs, credit_simulations (migration 0067)
phase: F20
task_ref: docs/planejamento-2026-06-multi-canal.md
status: in-progress
priority: high
estimated_size: M
agent_id: null
claimed_at: 2026-06-17T04:03:55Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F20-S02, F20-S03, F20-S04, F20-S05, F20-S06, F20-S07]
labels: [schema, multi-canal, whatsapp, db]
source_docs: []
docs_required: false
---

# F20-S01 — Schema: channel_id nos jobs e regras de followup/cobrança + credit_simulations

## Objetivo

Adicionar coluna `channel_id` (FK → channels, nullable) às tabelas que geram disparos de
WhatsApp fora do livechat: `followup_rules`, `followup_jobs`, `collection_rules`,
`collection_jobs` e `credit_simulations`. Isso é o prerequisito crítico de toda a F20.

## Contexto

Hoje, `followup-sender` e `collection-sender` instanciam `new MetaWhatsAppClient()` que
lê as credenciais das variáveis de ambiente `META_WHATSAPP_ACCESS_TOKEN` e
`META_WHATSAPP_PHONE_NUMBER_ID`. Isso limita o sistema a um único canal por organização e
impede o uso de canais cadastrados na tabela `channels` (que já existe e funciona — o
livechat-outbound já a usa corretamente).

A migração adiciona `channel_id` nullable nas tabelas-alvo. Os workers em F20-S03/S04
vão ler esse campo e carregar as credenciais do banco. Nullable por design: jobs históricos
ficam com `NULL` e os workers aplicam fallback para o canal padrão da org — sem quebra.

## Escopo (faz)

### Migration 0067

```sql
-- followup_rules: canal configurado na regra (opcional; null = usar padrão da org)
ALTER TABLE followup_rules
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- followup_jobs: canal resolvido no momento de criação do job
ALTER TABLE followup_jobs
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- collection_rules: idem followup_rules
ALTER TABLE collection_rules
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- collection_jobs: idem followup_jobs
ALTER TABLE collection_jobs
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- credit_simulations: canal escolhido pelo usuário ao disparar simulação
ALTER TABLE credit_simulations
  ADD COLUMN channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

-- Índices para lookup rápido por canal (ex: "quais jobs usam o canal X?")
CREATE INDEX ON followup_jobs (channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX ON collection_jobs (channel_id) WHERE channel_id IS NOT NULL;
```

### Schemas Drizzle

Atualizar:

- `apps/api/src/db/schema/followupRules.ts` — adicionar campo `channelId`
- `apps/api/src/db/schema/followupJobs.ts` — idem
- `apps/api/src/db/schema/collectionRules.ts` — idem
- `apps/api/src/db/schema/collectionJobs.ts` — idem
- `apps/api/src/db/schema/creditSimulations.ts` — idem

Padrão de campo em cada schema Drizzle:

```ts
channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'set null' }),
```

Importar `channels` de `'./channels.js'` onde necessário.

## Fora de escopo (NÃO faz)

- Nenhuma mudança em workers ou services
- Nenhuma mudança no frontend
- Não backfill de dados históricos (nullable; tratado nos workers com fallback)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/followupRules.ts`
- `apps/api/src/db/schema/followupJobs.ts`
- `apps/api/src/db/schema/collectionRules.ts`
- `apps/api/src/db/schema/collectionJobs.ts`
- `apps/api/src/db/schema/creditSimulations.ts`
- `apps/api/src/db/migrations/0067_channel_id_jobs_rules.sql`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/workers/**`
- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/langgraph-service/**`

## Contratos de saída

- Colunas `channel_id` (uuid, nullable, FK channels) existentes em todas as 5 tabelas
- Tipos Drizzle atualizados e exportados
- Migration aplica sem erro em banco com dados existentes (nullable — sem NOT NULL constraint)

## Definition of Done

- [ ] Migration 0067 aplica sem erro em banco limpo e em banco com dados (nullable = zero-downtime)
- [ ] Schemas Drizzle atualizados em todas as 5 tabelas com campo `channelId`
- [ ] FK `ON DELETE SET NULL` em todos os campos (protege contra exclusão de canal)
- [ ] Índices parciais em `followup_jobs` e `collection_jobs` para queries por canal
- [ ] `pnpm --filter @elemento/api db:migrate` verde
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- Verificar próximo número de migration: `ls apps/api/src/db/migrations/ | sort | tail -1` (esperado: 0067).
- `channelId` nullable não exige `DEFAULT` — `NULL` é semanticamente correto ("usar padrão da org").
- `ON DELETE SET NULL` (não CASCADE): se um canal for excluído, os jobs ficam com `channel_id = NULL`
  e os workers fazem fallback para o canal padrão — sem perda de jobs.
- Não adicionar `NOT NULL` agora: seria necessário backfill bloqueante em tabelas com dados.
  A constraint `NOT NULL` pode ser adicionada depois de S03/S04 garantirem que novos jobs
  sempre recebem `channel_id`.
- `credit_simulations` não precisa de índice adicional — volume é baixo e o campo é consultado
  apenas no momento do disparo.
