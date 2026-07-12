---
id: F6-S13
title: Backend — endpoint interno de leitura da conversa do lead (para resumo do copiloto)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S06]
blocks: [F6-S14]
labels: [backend, ai-assistant, rbac, lgpd-impact]
source_docs:
  [docs/22-agente-interno-acoes.md, docs/10-seguranca-permissoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S13 — Backend: endpoint de leitura da conversa do lead

## Objetivo

Expor um endpoint interno RBAC-bound que devolve as mensagens da conversa de um lead, para o copiloto
(F6-S14) poder resumir. Read-only, city-scoped, sem vazar PII bruta além do necessário.

## Contexto

Os endpoints do copiloto vivem em `apps/api/src/modules/internal/assistant/` (F6-S06), todos:

- protegidos por `X-Internal-Token` (guard já existente no `routes.ts`),
- RBAC por permissão + escopo de cidade,
- retornam dados para as tools do LangGraph.

Modelo (confirmado): `conversations.lead_id` → lead; `conversations.city_id` → escopo;
`messages.conversation_id` + `messages.content` (texto, PODE conter PII) + `messages.direction`
(`in`/`out`) + `messages.created_at`.

## Escopo (faz)

- **`POST /internal/assistant/lead-conversation`** em `internal/assistant/routes.ts` (+ controller/service/
  schemas do módulo). Request: `{ lead_id: uuid }` (ou identificador resolvido — ver notas). Response:
  `{ lead_id, messages: [{ direction, content, created_at }], truncated: boolean }`.
- **RBAC:** exige `livechat:conversation:read` (permissão canônica de "listar e visualizar conversas e
  mensagens", seed 0064). Aplicar **escopo de cidade**: só devolve conversa cujo `city_id` está no escopo
  do principal; fora do escopo → **404** (nunca vazar existência).
- **Multi-tenant:** filtrar por `organization_id` do principal.
- **Volume:** ordenar por `created_at`, **limitar** (ex.: últimas N=100 mensagens; `truncated=true` se
  cortou) — evita payload gigante ao LLM.
- **LGPD:** o texto (`content`) É PII e vai para o LangGraph, que aplica **DLP no gateway** antes do LLM
  (dlp=True já é padrão no copiloto). Este endpoint **não** loga `content` (pino.redact); devolve só o
  necessário. Sem telefone/CPF em campo separado — só o texto (que a DLP redige downstream).
- Validação Zod no request e response.

## Fora de escopo (NÃO faz)

- A tool do LangGraph (F6-S14).
- O resumo em si (o LLM resume; este endpoint só entrega as mensagens).
- Frontend (F6-S12). Prompt (F6-S15).

## Arquivos permitidos

- `apps/api/src/modules/internal/assistant/routes.ts`
- `apps/api/src/modules/internal/assistant/controller.ts`
- `apps/api/src/modules/internal/assistant/service.ts`
- `apps/api/src/modules/internal/assistant/schemas.ts`
- `apps/api/src/modules/internal/assistant/repository.ts`
- `apps/api/src/modules/internal/assistant/__tests__/**`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] `POST /internal/assistant/lead-conversation` com guard X-Internal-Token + `livechat:conversation:read`
- [ ] Escopo de cidade aplicado; conversa fora do escopo → 404 (sem vazar existência)
- [ ] Filtra `organization_id`; ordena por created_at; limita N e sinaliza `truncated`
- [ ] `content` nunca logado (pino.redact); Zod no request e response
- [ ] Testes: happy path, fora de escopo (404), sem permissão (403/401), lead sem conversa (vazio)
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Espelhe o padrão dos endpoints irmãos (`funnel-metrics`, `analysis-status`) em `routes.ts` — mesmo guard,
  mesmo estilo de RBAC + city scope.
- **Resolução do lead:** o request recebe `lead_id`. Se o produto quiser resolver por nome, isso fica na
  tool/LLM (F6-S14) ou num slot futuro — aqui aceite `lead_id`. Se `lead_id` não pertencer ao escopo/org → 404.
- LGPD é o eixo deste slot: `content` é PII. Não logar, não retornar telefone/CPF em separado; a DLP do
  gateway (F6-S14, dlp=True) redige o texto antes do LLM. Checklist §14.2 do doc 17 no PR.
