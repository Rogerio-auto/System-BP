---
id: F16-S49
title: Timeout do worker→langgraph muito curto p/ o agente (fallback handoff indevido)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: available
priority: critical
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: []
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S49 — Timeout do worker→langgraph p/ o pré-atendimento agêntico

## Problema (smoke real 2026-06-19 14:51)

O langgraph respondeu CERTO (`reply_type=text`, `handoff=false`, 4 mensagens, todos `/internal` 2xx),
mas o cliente recebeu só o **FALLBACK** "Olá! Um atendente vai te responder em instantes." (de
`apps/api/src/modules/livechat/ai-handoff.ts`).

Causa: o worker `livechat-ai.ts` chama o langgraph via `LangGraphClient` com `DEFAULT_TIMEOUT_MS = 8000`
(hardcoded — `startConsumer(defaultDb)` na linha ~362 passa `lgOptions={}`). O turno agêntico levou
**8769ms** > 8s → o cliente HTTP **aborta** → `catch (lgErr)` → handoff → FALLBACK. O pré-atendimento
agêntico (LLM raciocinando ~5s + idas/voltas no `/internal`) é mais lento que o funil determinístico;
8s não cabe. Também o `GRAPH_TIMEOUT_SEC` interno do langgraph (default 8.0) é apertado p/ turnos com
tool-calling.

## Escopo (faz)

- `apps/api/src/config/env.ts`: novo env `LANGGRAPH_AI_TIMEOUT_MS` (coerce number, default **25000**).
- `apps/api/src/workers/livechat-ai.ts`: `main()` passa `{ timeoutMs: env.LANGGRAPH_AI_TIMEOUT_MS }`
  para `startConsumer` → `processJob` → `new LangGraphClient({timeoutMs})`. (A cadeia já repassa
  `lgOptions`; só falta injetar do env no `main`.)
- `apps/langgraph-service/app/config.py`: `graph_timeout_sec` default **8.0 → 20.0** (env
  `GRAPH_TIMEOUT_SEC` continua sobrescrevendo). Headroom p/ turnos com tool-calling.
- `.env.example`: documentar `LANGGRAPH_AI_TIMEOUT_MS` e `GRAPH_TIMEOUT_SEC`.
- Manter coerência: worker timeout (25s) > langgraph interno (20s) + overhead, p/ o worker não abortar
  antes do langgraph terminar/devolver 504.

## Fora de escopo

- Lógica do agente / handoff real (continua funcionando p/ handoff legítimo).
- Otimizar latência do LLM (separado).

## Arquivos permitidos

- `apps/api/src/config/env.ts`
- `apps/api/src/workers/livechat-ai.ts`
- `apps/api/src/workers/__tests__/livechat-ai.test.ts`
- `apps/langgraph-service/app/config.py`
- `.env.example`

## Arquivos proibidos

- `apps/api/src/modules/livechat/ai-handoff.ts`

## Definition of Done

- [ ] `LANGGRAPH_AI_TIMEOUT_MS` no env (default 25000) e injetado no worker
- [ ] `graph_timeout_sec` default 20.0 no langgraph
- [ ] worker não cai em fallback para turno agêntico de ~8-12s
- [ ] `.env.example` documentado
- [ ] `pnpm --filter @elemento/api typecheck/lint/test` verdes
- [ ] PR aberto

## Comandos de validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api test
```
