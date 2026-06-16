---
id: F19-S01
title: Schema — law_firms + customer_law_firm_referrals (migration 0066)
phase: F19
task_ref: docs/planejamento-2026-06-evolucao.md
status: in-progress
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T14:52:04Z
completed_at: null
pr_url: null
depends_on: []
blocks: [F19-S02]
labels: [schema, advocacia, cobranca, db]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
docs_required: false
---

# F19-S01 — Schema: law_firms + customer_law_firm_referrals

## Objetivo

Criar as tabelas de escritórios de advocacia e de encaminhamentos de cliente para advogado (migration 0066).

## Contexto

Item 10 / Onda 4. Foundation de toda a Advocacia. Sem ela nenhum dos outros slots F19 pode avançar. Decisões já tomadas: D15 (padrão por cidade + ajuste manual), D17 (cooldown 7 dias).

## Escopo (faz)

### Tabela `law_firms`

- `id` uuid PK DEFAULT gen_random_uuid()
- `organization_id` uuid NOT NULL FK organizations
- `name` text NOT NULL
- `contact_phone` text (telefone público do escritório — não PII pessoal, sem criptografia)
- `coverage_city_ids` uuid[] NOT NULL DEFAULT '{}' (cidades de atuação do escritório)
- `is_default_for_city` boolean NOT NULL DEFAULT false (se é o padrão sugerido para as cidades de cobertura)
- `notes` text
- `created_by` uuid FK users
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- `deleted_at` timestamptz (soft delete)
- Índice B-tree: `(organization_id, deleted_at)` para listagem
- Índice GIN: `(coverage_city_ids)` para busca `= ANY(coverage_city_ids)`

### Tabela `customer_law_firm_referrals`

- `id` uuid PK DEFAULT gen_random_uuid()
- `organization_id` uuid NOT NULL FK organizations
- `customer_id` uuid NOT NULL FK customers
- `law_firm_id` uuid NOT NULL FK law_firms
- `linked_by` uuid FK users (null se canal = 'ai')
- `linked_at` timestamptz NOT NULL DEFAULT now()
- `sent_at` timestamptz (quando WhatsApp foi disparado; null = ainda não enviado)
- `channel` text NOT NULL CHECK (channel IN ('human', 'ai'))
- `cooldown_until` timestamptz (= sent_at + INTERVAL '7 days', persistido para queries simples)
- `notes` text
- `created_at` timestamptz NOT NULL DEFAULT now()
- Índice: `(customer_id, cooldown_until)` para check de cooldown
- Índice: `(organization_id, customer_id)` para listagem por cliente

### Permissões no seed

- Adicionar `law_firms:manage` ao catálogo (gestores/admin)
- Adicionar `law_firms:referral` ao catálogo (agentes)

## Fora de escopo (NÃO faz)

- CRUD de escritórios (F19-S02)
- Ação de encaminhamento (F19-S03)

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/db/schema/law-firms.ts`
- `apps/api/src/db/schema/index.ts`
- `apps/api/src/db/migrations/0066_law_firms.sql`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/src/modules/**`
- `apps/web/**`
- `apps/langgraph-service/**`

## Contratos de saída

- Tabelas `law_firms` e `customer_law_firm_referrals` existentes em Postgres
- Types Drizzle exportados de `apps/api/src/db/schema`

## Definition of Done

- [ ] Migration 0066 aplica sem erro em banco limpo e em banco com dados existentes
- [ ] Schema Drizzle tipado, exportado em `schema/index.ts`
- [ ] Permissões `law_firms:manage` e `law_firms:referral` seedadas
- [ ] `pnpm --filter @elemento/api db:migrate` verde
- [ ] `pnpm --filter @elemento/api typecheck` verde

## Comandos de validação

```powershell
pnpm --filter @elemento/api db:migrate
pnpm --filter @elemento/api typecheck
```

## Notas para o agente

- `contact_phone` é contato público do escritório (não dado pessoal) — sem criptografia.
- `coverage_city_ids uuid[]` com índice GIN para `WHERE $city_id = ANY(coverage_city_ids)`.
- `cooldown_until` persiste no banco (= sent_at + 7d) para queries simples; não calcular em runtime.
- A permissão `law_firms:manage` é para admins criarem/editarem escritórios; `law_firms:referral` para agentes usarem o botão de encaminhar.
- Verificar próximo número de migration: `ls apps/api/src/db/migrations/ | sort | tail -1` para confirmar 0066.
