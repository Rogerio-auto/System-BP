---
id: F7-S01
title: Configurar Kimi K2 como modelo default do reasoner LangGraph
phase: F7
task_ref: T7.1
status: available
priority: critical
estimated_size: S
agent_id: python-engineer
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F3-S00, F9-S00]
blocks: [F7-S09]
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/02-arquitetura-sistema.md
---

# F7-S01 — Configurar Kimi K2 como modelo default do reasoner

## Objetivo

Trocar o modelo do reasoner LangGraph de `anthropic/claude-sonnet-4` para `moonshot/kimi-k2` no OpenRouter — requisito explícito do CTO para o go-live. Inclui: env vars atualizadas, validação de existência do modelo, fallback configurado, preço cadastrado em `model_pricing` (F9-S00) e atualização do doc 06.

## Escopo

- `.env.example` e `.env`:
  - `LLM_MODEL_REASONER=moonshot/kimi-k2` (default)
  - `LLM_MODEL_CLASSIFIER=anthropic/claude-3.5-haiku` (mantido — classificação é hot path com latência crítica)
  - `LLM_MODEL_FALLBACK=anthropic/claude-sonnet-4` (Claude como fallback caso Kimi indisponível)
- `apps/langgraph-service/app/config.py`:
  - Atualizar defaults dos campos `model_reasoner` e `model_fallback`
  - Comentário explicando a escolha (Kimi K2 = throughput + custo + capacidade de raciocínio em PT-BR)
- `apps/langgraph-service/app/llm/factory.py`:
  - Atualizar docstring de `for_role()` com os novos defaults
- `apps/langgraph-service/app/llm/openrouter.py`:
  - Validar que o cliente OpenRouter funciona com `moonshot/kimi-k2` (sem mudança de código esperada — apenas teste de integração)
- Migration `0038_seed_kimi_k2_pricing.sql`:
  - INSERT em `model_pricing` para `moonshot/kimi-k2` (USD por 1M tokens conforme página de preços do OpenRouter no snapshot do PR)
  - Mantém preços existentes ativos (não desativa Claude — fallback usa)
- Teste de integração:
  - `apps/langgraph-service/tests/llm/test_kimi_k2_smoke.py` — chamada real ao gateway com fixture pequena (gated por env `RUN_LLM_SMOKE_TESTS=1`, default off em CI)
  - Mock-test garantindo que `for_role('reasoner')` retorna `moonshot/kimi-k2`
- Atualizar `docs/06-langgraph-agentes.md` §2 com nova tabela de modelos por role
- Atualizar `docs/11-roadmap-executavel.md` §3 (riscos da Fase 3) — substituir "Sonnet/Haiku" por "Kimi K2 / Haiku" no parágrafo de mitigação de latência
- Atualizar `CLAUDE.md` (raiz) se mencionar Sonnet como reasoner

### Fallback automático

O `gateway.py` já tem retry com fallback de modelo em caso de 5xx ou rate-limit (F3-S00). Validar que `LLM_MODEL_FALLBACK=anthropic/claude-sonnet-4` é honrado nesse caminho — escrever teste se ainda não há.

## Fora de escopo

- Reescrever prompts para o estilo Kimi (slot opcional pós-launch se observar baixa qualidade)
- Trocar classifier para outro modelo (Haiku continua melhor custo/latência para classificação)
- Métricas dedicadas de latência Kimi vs Claude (entra em F7-S09 monitoramento)

## Arquivos permitidos

```
.env.example
.env
apps/langgraph-service/app/config.py
apps/langgraph-service/app/llm/factory.py
apps/langgraph-service/app/llm/openrouter.py
apps/langgraph-service/tests/llm/test_kimi_k2_smoke.py
apps/langgraph-service/tests/llm/test_factory_defaults.py
apps/api/src/db/migrations/0038_seed_kimi_k2_pricing.sql
apps/api/src/db/migrations/meta/_journal.json
docs/06-langgraph-agentes.md
docs/11-roadmap-executavel.md
CLAUDE.md
```

## Definition of Done

- [ ] Defaults atualizados em `config.py`
- [ ] `.env.example` com 3 modelos e comentário explicativo
- [ ] Migration 0038 cria entry de pricing para Kimi K2 (snapshot OpenRouter datado)
- [ ] Teste smoke (gated por env) passa contra OpenRouter real
- [ ] Teste mock garante `for_role('reasoner') == 'moonshot/kimi-k2'`
- [ ] Doc 06 §2 atualizado com tabela de modelos
- [ ] Doc 11 §3 (Fase 3 riscos) menciona Kimi K2
- [ ] CLAUDE.md raiz revisado (não menciona Sonnet como reasoner)
- [ ] Fallback testado: Kimi 5xx → Claude responde

## Validação

```powershell
python scripts/slot.py check-migrations
cd apps/langgraph-service ; uv run ruff check . ; uv run mypy app ; uv run pytest -q tests/llm/
pnpm --filter @elemento/api db:migrate
```
