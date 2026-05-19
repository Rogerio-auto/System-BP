---
id: F3-S05
title: Endpoint POST /internal/cities/identify (fuzzy match)
phase: F3
task_ref: T3.5
status: review
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-19T00:22:29Z
completed_at: 2026-05-19T00:28:45Z
pr_url:
depends_on: [F3-S04]
blocks: [F3-S14]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/04-eventos.md
---

# F3-S05 — Endpoint interno identify_city

## Objetivo

Resolver a cidade a partir de texto livre do cliente, com fuzzy match
`pg_trgm` + `unaccent`. Consumido pela tool `identify_city` (F3-S14).

## Escopo

### `POST /internal/cities/identify`

- Auth `X-Internal-Token` → 401 sem.
- Body Zod: `{ leadId?, cityText }`.
- Query em `cities.name` + `cities.aliases` com `pg_trgm` + `unaccent`
  (reusar helper de busca do módulo `cities` de F1-S06; se inexistente, criar).
- Regras (doc 06 §7.2):
  - `confidence >= 0.85` → `matched: true`.
  - `confidence < 0.85` → `matched: false` + `alternatives` (top 3).
  - Cidade fora da lista atendida → `matched: false, out_of_service: true`.
- Resposta: `{ city_id, city_name, matched, confidence, out_of_service, alternatives[] }`.
- Emite `cities.identified` via outbox quando `matched: true` e `leadId` informado.

## Fora de escopo

- Tool Python (F3-S14). Atualização do lead com a cidade (é `update_lead_profile`, F3-S12).

## Arquivos permitidos

- `apps/api/src/modules/internal/cities/routes.ts`
- `apps/api/src/modules/internal/cities/schemas.ts`
- `apps/api/src/modules/internal/cities/__tests__/routes.test.ts`
- `apps/api/src/modules/cities/repository.ts` (só se precisar do helper fuzzy)

> A sub-rota é descoberta pelo autoload do plugin agregador (F3-S04) — não há
> arquivo compartilhado a editar.

## Definition of Done

- [ ] `X-Internal-Token` exigido → 401.
- [ ] Fuzzy match com `unaccent` resolve acentos/erros de digitação.
- [ ] `confidence < 0.85` retorna `matched: false` + 3 alternativas.
- [ ] `out_of_service` para cidade não atendida.
- [ ] `cities.identified` emitido quando `matched: true`.
- [ ] `pnpm --filter @elemento/api typecheck && lint && test` verdes.

## Validação

```powershell
pnpm --filter @elemento/api test -- internal/cities
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api typecheck
```
