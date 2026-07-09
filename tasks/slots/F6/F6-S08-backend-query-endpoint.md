---
id: F6-S08
title: Backend — POST /api/internal-assistant/query (injeta principal → grafo) + guard + log
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: high
estimated_size: M
agent_id: null
depends_on: [F6-S05, F6-S07]
blocks: [F6-S09]
labels: [backend, ai-assistant, rbac, audit, feature-flags]
source_docs: [docs/22-agente-interno-acoes.md, docs/10-seguranca-permissoes.md]
docs_required: false
completed_at: 2026-07-09T14:11:12Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/409
---

# F6-S08 — Backend: endpoint público do copiloto

## Objetivo

Expor `POST /api/internal-assistant/query`: recebe a pergunta do usuário autenticado, **injeta o
principal dele** (permissions + cityScopeIds) e chama o grafo `internal_assistant`, registrando a
consulta em `assistant_queries` (doc 22 §12.4/§12.5).

## Escopo (faz)

- `POST /api/internal-assistant/query` (guard `authorize({permissions:['ai_assistant:use']})` +
  gate por flag `ai.internal_assistant.enabled`). Zod request (`{question}`) / response
  (`{answer, sources[]}`).
- Deriva o principal do `request.user` (user_id, organization_id, permissions, cityScopeIds) e o
  encaminha ao serviço LangGraph junto da pergunta. **Nunca** confia em escopo vindo do corpo.
- Aplica DLP na pergunta antes de qualquer coisa; grava `assistant_queries`
  (`question_redacted`, `tools_called`, `city_scope_snapshot`, `answer_summary`). Audit com o
  **usuário** como actor.
- Rate-limit por usuário; timeout + fallback gracioso ("não consegui consultar agora").

## Fora de escopo (NÃO faz)

- Grafo (F6-S07) e endpoints de leitura (F6-S06).
- UI de chat (F6-S09).

## Arquivos permitidos

- `apps/api/src/modules/internal-assistant/routes.ts`
- `apps/api/src/modules/internal-assistant/controller.ts`
- `apps/api/src/modules/internal-assistant/service.ts`
- `apps/api/src/modules/internal-assistant/schemas.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/internal-assistant/__tests__/query.test.ts`

## Arquivos proibidos

- `apps/web/**`
- `apps/langgraph-service/**`
- `apps/api/src/db/migrations/**`

## Definition of Done

- [ ] `POST /api/internal-assistant/query` gated por `ai_assistant:use` + flag
- [ ] Principal derivado do JWT (não do corpo); encaminhado ao grafo
- [ ] Pergunta passa por DLP; `assistant_queries` gravado sem PII bruta; audit com usuário
- [ ] Rate-limit + timeout/fallback; Zod nas bordas
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
python scripts/slot.py validate F6-S08
```

## Notas para o agente

- O escopo é sempre do `request.user`. Se o corpo tentar mandar city/permissions, ignorar.
- Registrar rota em `app.ts` (roteador vivo).

## ⚠️ Herança do security review de F6-S05 (PR #400, mergeado)

- **M-2 — DLP é 100% responsabilidade deste endpoint.** `assistant_queries.question_redacted` é
  `text NOT NULL` **sem CHECK no DB**: nada na camada de dados impede persistir a pergunta bruta.
  Aplicar `dlp_filter()` ANTES de gravar e **provar em teste** que a string persistida é a versão
  pós-DLP (jamais CPF/telefone/nome). O DoD já exige "sem PII bruta" — este teste é obrigatório.
- **L-1 — `user_id` sempre do principal.** A coluna é nullable no schema; aqui deve vir SEMPRE do
  `request.user`, nunca do corpo. Ignorar/rejeitar qualquer `user_id` do payload.
- **L-2 — JSONB `tools_called`/`city_scope_snapshot`.** Persistir só IDs de entidade e agregados;
  validar via Zod antes de gravar — nada de PII em `args`.
