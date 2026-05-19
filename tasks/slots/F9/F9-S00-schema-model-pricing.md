---
id: F9-S00
title: Schema model_pricing — preços por modelo LLM (USD) + FX para BRL
phase: F9
task_ref: T9.0
status: done
priority: high
estimated_size: S
agent_id: db-schema-engineer
claimed_at: 2026-05-19T22:09:48Z
completed_at: 2026-05-19T22:28:14Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/113
depends_on: []
blocks: [F9-S02]
labels: []
source_docs:
  - docs/03-modelo-dados.md
  - docs/05-modulos-funcionais.md
  - docs/12-tasks-tecnicas.md
---

# F9-S00 — Schema `model_pricing`

## Objetivo

Persistir preços de cada modelo LLM usado pelo agente para que o Console (F9-S06) consiga exibir custo em USD e BRL por decisão. Sem esta tabela, o viewer mostra apenas tokens crus.

## Contexto

`ai_decision_logs` (F3-S01) já registra `model`, `tokens_in`, `tokens_out` por decisão — mas o sistema não tem onde guardar o preço por 1M de tokens de cada modelo. Cálculo de custo hoje é impossível.

## Escopo

- Migration `apps/api/src/db/migrations/0026_model_pricing.sql` criando a tabela `model_pricing`:
  - `id uuid primary key default gen_random_uuid()`
  - `provider text not null` (ex: `openrouter`, `anthropic`, `openai`)
  - `model_id text not null` (ex: `anthropic/claude-3-5-sonnet`, `openai/gpt-4o-mini`) — corresponde ao valor gravado em `ai_decision_logs.model`
  - `input_cost_per_million_usd numeric(12,4) not null` (USD por 1.000.000 tokens de input)
  - `output_cost_per_million_usd numeric(12,4) not null` (USD por 1.000.000 tokens de output)
  - `effective_from timestamptz not null default now()` — quando este preço passou a valer
  - `effective_to timestamptz` — `null` = atualmente em vigor
  - `notes text` — changelog/fonte (ex: "snapshot OpenRouter 2026-05-19")
  - `created_by uuid` (FK `users.id` `on delete set null`)
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()` + trigger de update
- **Constraints:**
  - `unique partial index uq_model_pricing_active on (provider, model_id) where effective_to is null` — garante 1 preço ativo por (provider, model) a cada momento.
  - `check (effective_to is null or effective_to > effective_from)`.
  - `check (input_cost_per_million_usd >= 0 and output_cost_per_million_usd >= 0)`.
- **Entry em `meta/_journal.json`** no mesmo commit (regra do PROTOCOL.md §3).
- Schema Drizzle `apps/api/src/db/schema/modelPricing.ts` espelhando a tabela.
- `apps/api/src/db/schema/index.ts` re-exporta.
- Seed `apps/api/src/db/seed/modelPricing.ts` populando os modelos atualmente usados pelo agente (`anthropic/claude-3-5-sonnet`, `openai/gpt-4o-mini`, `anthropic/claude-3-5-haiku` ou os que estiverem em uso — verificar no gateway `apps/langgraph-service/app/llm/gateway.py`). Cada entry com `notes` indicando a fonte do preço e data do snapshot.
- Env var `FX_BRL_PER_USD` adicionada ao schema Zod em `apps/api/src/config/env.ts` (`.min(0)` obrigatório; default em `.env.example`). Conversão BRL é calculada na borda (service de F9-S02) — **não persistir BRL na tabela** (FX muda; preço em USD é a verdade canônica).
- Helper `apps/api/src/lib/pricing.ts` exportando `priceModelTokens({ provider, model, tokensIn, tokensOut })` que retorna `{ costUsd, costBrl }` consultando `model_pricing` para o registro ativo. Usado por F9-S02.

## Operação manual de update de preço

Atualizar preço de um modelo não é PATCH na linha — é:

1. `UPDATE model_pricing SET effective_to = now() WHERE provider = $1 AND model_id = $2 AND effective_to IS NULL` (encerra o ativo).
2. `INSERT model_pricing(...) VALUES (...)` (cria o novo).

Transação obrigatória. UI para gerir isso fica em backlog (slot futuro `F9-S08 — admin model_pricing`); por enquanto, mudanças via seed/script.

## Auditoria

- Inserção em `model_pricing` registra em `audit_logs` com `action=model_pricing.created` (quando feita via service/seed que faça audit). Para o MVP, seeds não auditam — slot futuro de UI cobrirá.

## LGPD

- Sem PII. Apenas dados operacionais técnicos. Sem label `lgpd-impact`.

## Fora de escopo

- UI admin para gerir model_pricing (backlog).
- Histórico de variação de FX por dia (backlog — para o MVP, FX é constante via env).
- Modelos sem entry em `model_pricing` → helper retorna `costUsd: null, costBrl: null` (F9-S06 mostra "—" para esses).

## Arquivos permitidos

- `apps/api/src/db/migrations/0026_model_pricing.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/modelPricing.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/seed/modelPricing.ts`
- `apps/api/src/db/seed/index.ts` (se houver agregador)
- `apps/api/src/lib/pricing.ts`
- `apps/api/src/lib/__tests__/pricing.test.ts`
- `apps/api/src/config/env.ts`
- `.env.example`

## Definition of Done

- [ ] Migration aplica em DB limpo (`pnpm db:migrate`).
- [ ] `check-migrations` verde (journal sincronizado).
- [ ] Constraints validadas em teste (`check` rejeita custos negativos e `effective_to <= effective_from`).
- [ ] Unique parcial valida 1 preço ativo por modelo (insert duplicado falha).
- [ ] Seed popula os modelos em uso.
- [ ] `priceModelTokens` retorna `{costUsd, costBrl}` correto para modelo conhecido; `{null, null}` para desconhecido.
- [ ] `FX_BRL_PER_USD` obrigatório no env; boot falha se ausente.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test -- pricing
```
