---
id: F16-S33
title: Timeout do grafo configurável por env (GRAPH_TIMEOUT_SEC)
phase: F16
task_ref: docs/06-langgraph-agentes.md
status: review
priority: medium
estimated_size: XS
agent_id: null
claimed_at: 2026-06-18T02:36:41Z
completed_at: 2026-06-18T02:53:03Z
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

# F16-S33 — Timeout do grafo configurável por env

## Objetivo

Tornar o timeout do grafo `process/whatsapp/message` configurável via env
(`GRAPH_TIMEOUT_SEC`), mantendo o **default 8.0s** (SLA do doc 06 §4.4) intacto em produção, para
permitir afrouxar em ambiente local/homologação (LLM frio é mais lento).

## Contexto

Hoje `_GRAPH_TIMEOUT_SEC: float = 8.0` é constante de módulo em `app/api/process.py:270`. Em teste
local, `load_state` (~2s) + classify LLM (~3.4s) + criação de lead + LLM de resposta ultrapassam 8s
e o grafo aborta com `process_whatsapp_timeout` antes de responder. O valor é correto para prod;
precisa apenas ser ajustável por env sem mudar código.

## Escopo (faz)

- Adicionar setting em `app/config.py` (`Settings`): `graph_timeout_sec: float = Field(default=8.0,
validation_alias="GRAPH_TIMEOUT_SEC")`.
- Em `app/api/process.py`: usar `settings.graph_timeout_sec` no `asyncio.wait_for(...)` em vez da
  constante de módulo `_GRAPH_TIMEOUT_SEC` (remover a constante ou apontá-la para o setting).
- Documentar a env no `.env.example` (linha comentada, default 8.0, com nota de que é só para
  homologação local — prod mantém 8s).
- Teste: setting respeita o env (default 8.0; override via env reflete em `settings.graph_timeout_sec`).

## Fora de escopo (NÃO faz)

- Mudar o timeout do playground (`_PLAYGROUND_GRAPH_TIMEOUT_SEC`, 15s) — fora do caminho de produção.
- Alterar lógica de retry/handoff no timeout (handoff é F16-S30).

## Arquivos permitidos (`files_allowed`)

- `apps/langgraph-service/app/config.py`
- `apps/langgraph-service/app/api/process.py`
- `apps/langgraph-service/tests/test_config.py`
- `.env.example`

## Arquivos proibidos (`files_forbidden`)

- `apps/langgraph-service/app/api/playground.py`
- `apps/langgraph-service/app/graphs/**`

## Contratos de entrada

- `Settings` (pydantic-settings) com `validation_alias` por env.
- `asyncio.wait_for(graph.ainvoke(...), timeout=...)` em `process.py`.

## Contratos de saída

- `GRAPH_TIMEOUT_SEC` no env altera o timeout efetivo; ausente → 8.0s (comportamento atual).

## Definition of Done

- [ ] `settings.graph_timeout_sec` (default 8.0, alias `GRAPH_TIMEOUT_SEC`)
- [ ] `process.py` usa o setting; constante hardcoded removida/redirecionada
- [ ] `.env.example` documenta a env (default + nota homologação)
- [ ] Teste de config: default e override por env
- [ ] `uv run pytest` (ou `python -m pytest`) verde no serviço
- [ ] `ruff`/lint do serviço verde
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest tests/test_config.py -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- Default 8.0 é normativo (doc 06 §4.4) — NÃO mudar o default, só permitir override.
- `GRAPH_TIMEOUT_SEC` é lido do mesmo `.env` da raiz (o serviço não tem `.env` próprio).
- Manter o log `process_whatsapp_timeout` (apenas a fonte do valor muda).
