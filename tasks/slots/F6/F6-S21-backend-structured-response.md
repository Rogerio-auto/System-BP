---
id: F6-S21
title: Backend — contrato de resposta estruturada do copiloto (narrativa + blocos)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S20]
blocks: [F6-S22, F6-S24]
labels: [backend, ai-assistant, architecture]
source_docs: [docs/22-agente-interno-acoes.md, docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
claimed_at: 2026-07-14T17:14:08Z
completed_at: 2026-07-14T17:21:27Z
---

# F6-S21 — Backend: contrato de resposta estruturada

## Objetivo

Fazer o endpoint do copiloto repassar a resposta estruturada do LangGraph (F6-S20) — narrativa + blocos
referenciados — ao frontend, mantendo compat com o contrato antigo `{ answer, sources }`.

## Escopo (faz)

- `AssistantQueryResponseSchema` (`internal-assistant/schemas.ts`) ganha a forma estruturada:
  `{ narrative: string, blocks: Block[], sources: string[] }` com `Block = { type, ref: { kind, lead_id? }, value }`.
- Manter `answer` no response como campo **derivado/legado** (narrativa + blocos serializados) durante a
  transição — nenhuma chamada antiga quebra.
- `LangGraphAssistantResponseSchema` acompanha a forma que o LangGraph devolve.
- Service repassa; nenhum dado persistido (Fase 2). **Nunca logar** `value`/PII dos blocos.
- Zod no response.

## Fora de escopo (NÃO faz)

- LangGraph (F6-S20). Frontend (F6-S22). Persistência (Fase 2).

## Arquivos permitidos

- `apps/api/src/modules/internal-assistant/schemas.ts`
- `apps/api/src/modules/internal-assistant/service.ts`
- `apps/api/src/modules/internal-assistant/controller.ts`
- `apps/api/src/modules/internal-assistant/__tests__/**`

## Arquivos proibidos

- `apps/web/**`, `apps/langgraph-service/**`, `apps/api/src/db/**`

## Definition of Done

- [ ] Response = `{ narrative, blocks:[{type, ref, value}], sources }` + `answer` legado derivável
- [ ] Zod no response; `value`/PII dos blocos nunca logados
- [ ] Compat: chamadas que só leem `answer` seguem funcionando
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/api typecheck
pnpm --filter @elemento/api lint
pnpm --filter @elemento/api test
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Alinhe o contrato EXATO com F6-S20 (mesma forma de `Block`/`ref`). Este slot não persiste — liberado antes
  do parecer do DPO.
