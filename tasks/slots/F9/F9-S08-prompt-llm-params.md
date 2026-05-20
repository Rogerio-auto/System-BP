---
id: F9-S08
title: Parametrização de modelo no editor de prompts — temperature, max_tokens, top_p
phase: F9
task_ref: T9.8
status: done
priority: medium
estimated_size: M
agent_id: backend-engineer
claimed_at: 2026-05-20T13:07:40Z
completed_at: 2026-05-20T13:27:17Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/126
depends_on: [F9-S01, F9-S05, F3-S00]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/06-langgraph-agentes.md
  - docs/12-tasks-tecnicas.md
  - docs/18-design-system.md
---

# F9-S08 — Parametrização de modelo no editor de prompts

## Objetivo

Permitir que o admin ajuste **temperature**, **max_tokens** e **top_p** por versão de prompt diretamente pelo editor da UI (F9-S05) — sem precisar mexer em código nem no `.env` do langgraph-service. Hoje esses parâmetros estão fixos no gateway Python, o que limita experimentação.

## Contexto

`prompt_versions` (F3-S01) hoje tem `key`, `version`, `body`, `model_recommended`, `content_hash`, `active`, `notes`. O editor (F9-S05) já expõe `body`/`notes`/`model_recommended`. Falta expor os 3 parâmetros mais usados de fine-tuning de saída do LLM. O gateway (`apps/langgraph-service/app/llm/gateway.py`) recebe esses parâmetros via signature de `gateway.complete()`, mas hoje o orquestrador dos nós passa valores hardcoded ou pega de `settings` global.

## Escopo (vertical slice)

### Schema (DB + Drizzle)

- Migration `apps/api/src/db/migrations/0030_prompt_versions_llm_params.sql`:
  - `ALTER TABLE prompt_versions ADD COLUMN temperature numeric(3,2)` (nullable; default `null`).
  - `ALTER TABLE prompt_versions ADD COLUMN max_tokens integer` (nullable).
  - `ALTER TABLE prompt_versions ADD COLUMN top_p numeric(3,2)` (nullable).
  - `CHECK (temperature is null or (temperature >= 0 and temperature <= 2))`.
  - `CHECK (max_tokens is null or (max_tokens >= 1 and max_tokens <= 32000))`.
  - `CHECK (top_p is null or (top_p > 0 and top_p <= 1))`.
- `meta/_journal.json`: entry idx 30.
- `apps/api/src/db/schema/promptVersions.ts`: 3 colunas novas com `numeric`/`integer` Drizzle + comentários explicando que `null` = usar default do gateway (não persistir valores default no DB para não engessar a mudança futura de default).

### Backend (API)

- `apps/api/src/modules/ai-console/prompts/schemas.ts`: Zod schemas estendem com `temperature: z.number().min(0).max(2).nullable().optional()`, idem `max_tokens` e `top_p`.
- `service.ts`: passar campos para `repository.insert`; `repository.find*` retorna; service mantém imutabilidade — vez de PATCH, vira nova versão.
- `controller.ts`: response inclui os 3 campos novos.
- Sem mudança de RBAC — `ai_prompts:write` continua sendo a barreira para criar nova versão.
- Testes: criação com valores válidos, rejeição de inválidos (temperature 3.0, max_tokens 0, top_p 1.5), null aceito.

### LangGraph (Python)

- `apps/langgraph-service/app/tools/_base.py` (ou um helper específico de prompts): adicionar função `get_active_prompt(key) → { body, model, temperature?, max_tokens?, top_p? }` que consulta backend via `GET /internal/prompts/:key/active` **ou** usa o snapshot já carregado pelo grafo. Verificar como F3-S26 (classify_intent etc.) carrega prompts hoje — extender, não reimplementar.
- Nós que chamam `gateway.complete(...)` (`classify_intent`, `qualify_credit_interest`, `generate_simulation`): passar `temperature`/`max_tokens`/`top_p` do prompt ativo quando não-null; senão usar defaults do gateway.
- `gateway.complete()` já aceita esses parâmetros — só ajustar callers para preencher.
- Testes: nó com prompt que tem temperature setada confirma que o gateway recebeu o valor correto (mock do gateway.complete + assert kwargs).

> **NOTA pro engenheiro:** se a leitura de `prompt_versions` no LangGraph hoje for via constante hardcoded em Python (ex.: prompts inline em arquivos `.md` no repo), o slot exige uma reestruturação maior (carregar do DB). Pare e reporte — abra sub-slot de "migrar prompts in-code para DB". Se já vem do backend via `/internal/prompts/active`, é só estender.

### Frontend (Web)

- `apps/web/src/features/configuracoes/ai-console/prompts/PromptEditor.tsx`: na seção do form (abaixo de `model_recommended`), adicionar 3 campos numéricos:
  - **Temperature** (slider 0–2, step 0.1, ou number input, placeholder "1.0 — padrão").
  - **Max tokens** (number input, placeholder "auto — usa default do modelo").
  - **Top P** (slider 0.01–1, step 0.01, placeholder "auto").
  - Helper text em cada campo explicando o efeito + range válido.
  - `null` quando o campo está vazio (operador opta por usar default do modelo).
- Tooltip de aviso: "Valores não-default afetam consistência e custo das respostas. Teste no Playground antes de ativar."
- Detalhe da versão: mostrar os 3 valores (ou "auto" quando `null`).
- Diff entre versões: comparar os 3 campos como qualquer outro.

## LGPD

Sem PII. Sem label `lgpd-impact`.

## Fora de escopo

- Outros parâmetros (frequency_penalty, presence_penalty, response_format) — abrir slots dedicados se demanda surgir.
- A/B de temperatura no mesmo run no playground (backlog).
- Migração de prompts hardcoded em Python para DB (se for o caso, sub-slot).

## Arquivos permitidos

- `apps/api/src/db/migrations/0030_prompt_versions_llm_params.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/db/schema/promptVersions.ts`
- `apps/api/src/modules/ai-console/prompts/repository.ts`
- `apps/api/src/modules/ai-console/prompts/service.ts`
- `apps/api/src/modules/ai-console/prompts/schemas.ts`
- `apps/api/src/modules/ai-console/prompts/controller.ts`
- `apps/api/src/modules/ai-console/prompts/__tests__/prompts.routes.test.ts`
- `apps/langgraph-service/app/tools/_base.py` (ou helper específico — engineer decide)
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`
- `apps/langgraph-service/tests/graphs/test_classify_intent.py`
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptEditor.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/PromptDetailPage.tsx`
- `apps/web/src/features/configuracoes/ai-console/prompts/__tests__/prompts.test.tsx`
- `apps/web/src/hooks/ai-console/usePrompts.ts`

## Definition of Done

- [ ] Migration aplica em DB limpo; `check-migrations` verde.
- [ ] Constraints CHECK testadas (temperature 3.0 → 23, top_p > 1 → 23, max_tokens 0 → 23).
- [ ] Criação de versão com os 3 campos preenchidos vira nova `prompt_versions` row com os valores corretos.
- [ ] Criação com os 3 campos ausentes/null vira row com `null` em todos (sem default no DB).
- [ ] Nó `classify_intent` passa `temperature` ao gateway quando o prompt ativo tem o valor preenchido — testado com mock do `gateway.complete`.
- [ ] UI: 3 campos novos no editor, com tooltip de aviso e helper text. Detalhe da versão mostra valores ou "auto" quando null.
- [ ] Sem regressão nos 22 testes existentes de prompts.routes.test.ts.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` verdes em api/web.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes em langgraph-service.

## Validação

```powershell
pnpm --filter @elemento/api db:migrate
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test -- ai-console/prompts
pnpm --filter @elemento/web typecheck && pnpm --filter @elemento/web build
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
