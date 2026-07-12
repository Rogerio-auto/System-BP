---
id: F6-S16
title: Backend — endpoint interno de busca de lead por nome (para o copiloto resolver o lead)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: S
agent_id: null
depends_on: [F6-S06]
blocks: [F6-S14]
labels: [backend, ai-assistant, rbac, lgpd-impact]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-12T16:50:14Z
completed_at: 2026-07-12T16:57:09Z
---

# F6-S16 — Backend: busca de lead por nome (para o copiloto)

## Objetivo

Expor um endpoint interno RBAC-bound que busca leads por nome, para o copiloto (F6-S14) resolver "resuma a
conversa da Maria" → `lead_id`, com desambiguação de homônimos. Read-only, scoped, PII mínima.

## Contexto

Decisão de UX (2026-07-12): o usuário nomeia o lead em linguagem natural; a IA resolve. Fluxo agêntico:
`find_lead(nome)` → candidatos → se 1, resume; se vários, a IA pergunta qual; se nenhum, avisa.

Reuso: `findLeads(db, organizationId, cityScopeIds, query)` (`apps/api/src/modules/leads/repository.ts:246`)
JÁ busca por `name`/`phone_e164`, scoped por org + cidade, paginado. **Não reimplementar** — chamar essa.
Endpoints irmãos do copiloto em `internal/assistant/` (F6-S06): guard `X-Internal-Token` + RBAC + city scope.

## Escopo (faz)

- **`POST /internal/assistant/lead-search`** em `internal/assistant/`. Request: `{ principal, name: string(min 2) }`.
  Response: `{ source, candidates: [{ lead_id, name, city_name | null }], truncated }`.
- **RBAC:** exige `leads:read`. **Escopo de cidade** + `organization_id` do principal aplicados (via os args
  de `findLeads` — `cityScopeIds` do principal).
- **Volume:** limitar candidatos (ex.: 8); `truncated=true` se houver mais — evita despejo e força o usuário a
  refinar. Ordenar por relevância/nome.
- **LGPD (minimização):** devolver **apenas** `lead_id`, `name` e `city_name` — o mínimo para desambiguar.
  **Nunca** telefone, CPF, e-mail. **Nunca** logar `name` das buscas (pino.redact). Zod no request e response.

## Fora de escopo (NÃO faz)

- A tool do LangGraph (F6-S14). O resumo (F6-S13, já feito). Frontend (F6-S12, já feito). Prompt (F6-S15).
- Busca por telefone/CPF (só nome).

## Arquivos permitidos

- `apps/api/src/modules/internal/assistant/routes.ts`
- `apps/api/src/modules/internal/assistant/schemas.ts`
- `apps/api/src/modules/internal/assistant/service.ts`
- `apps/api/src/modules/internal/assistant/repository.ts`
- `apps/api/src/modules/internal/assistant/__tests__/**`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`
- `apps/api/src/modules/leads/repository.ts` (só CHAMAR `findLeads`, não editar)

## Definition of Done

- [ ] `POST /internal/assistant/lead-search` com guard X-Internal-Token + `leads:read`
- [ ] Reusa `findLeads` (org + cityScope + search por nome); não reimplementa busca
- [ ] Response só `lead_id`/`name`/`city_name`; limite + `truncated`; sem telefone/CPF/e-mail
- [ ] `name` da busca nunca logado; Zod no request e response
- [ ] Testes: match único, múltiplos (desambiguação), nenhum, sem permissão (403), fora de escopo (não vaza)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Espelhe o `lead-conversation` (F6-S13) recém-adicionado no mesmo `routes.ts` — mesmo guard, mesmo estilo.
- `city_name`: resolver o nome da cidade do lead (join leve) só para exibir ao usuário; se custar, devolver
  `city_id` e deixar o nome para a UI. Não vaze cidade fora do escopo.
- Slot `lgpd-impact`: checklist §14.2 do doc 17 no relatório (dado = nome do lead; minimização; sem telefone).
