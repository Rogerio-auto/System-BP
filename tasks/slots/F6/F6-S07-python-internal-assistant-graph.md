---
id: F6-S07
title: Python — grafo internal_assistant + tools de leitura + prompt (sem escrita)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: high
estimated_size: L
agent_id: null
depends_on: [F6-S06]
blocks: [F6-S08]
labels: [python, langgraph, ai-assistant, dlp]
source_docs: [docs/22-agente-interno-acoes.md, docs/06-langgraph-agentes.md]
docs_required: false
claimed_at: 2026-07-08T02:26:04Z
completed_at: 2026-07-08T03:06:55Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/405
---

# F6-S07 — Python: grafo internal_assistant

## Objetivo

Implementar o grafo do copiloto interno (doc 22 §12.4), separado da Ana Clara, com **apenas tools
de leitura** que chamam os endpoints RBAC-bound de F6-S06 — carregando o principal do usuário.

## Contexto

Skill `/langgraph-agent`. O principal (`user_id`, `permissions`, `city_scope_ids`, `organization_id`)
é threaded do state para cada tool (análogo à pegadinha de `organization_id`). A IA nunca infere
escopo — recebe-o. Read-only: nenhuma tool de escrita.

## Escopo (faz)

- Novo grafo `apps/langgraph-service/app/graphs/internal_assistant/` (state, nodes, graph), com um
  nó agêntico de tool-calling read-only.
- Tools de leitura (`app/tools/assistant_tools.py`) chamando `/internal/assistant/*` (F6-S06),
  enviando o principal do state. Retorno estruturado + `source`.
- Prompt do copiloto em `prompt_versions` (seed) ou `app/prompts/internal_assistant.md`: papel
  (responder sobre dados operacionais), restrições (só o que o usuário pode ver; não decide crédito;
  não escreve; cita a fonte; se não houver dado no escopo, dizer que não encontrou **sem** especular).
- DLP no gateway continua ligado; registrar `model`/`prompt_version` para auditoria.

## Fora de escopo (NÃO faz)

- Endpoint `/api/internal-assistant/query` (F6-S08).
- Endpoints /internal (F6-S06, prontos).
- Qualquer tool de escrita.

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/internal_assistant/**`
- `apps/langgraph-service/app/tools/assistant_tools.py`
- `apps/langgraph-service/app/prompts/internal_assistant.md`
- `apps/langgraph-service/app/main.py`
- `apps/langgraph-service/tests/test_internal_assistant.py`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/**`

## Definition of Done

- [ ] Grafo `internal_assistant` isolado, read-only, com tool-calling
- [ ] Principal do usuário threaded para todas as tools; nunca inferido
- [ ] Prompt: cita fonte, não decide crédito, não especula fora do escopo
- [ ] DLP ligado; `model`/`prompt_version` logados
- [ ] `ruff check .` + `mypy app` + `pytest -q` verdes

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
python scripts/slot.py validate F6-S07
```

## Notas para o agente

- Não confiar no LLM para filtrar escopo — o filtro é no backend (F6-S06). O prompt só orienta tom/limites.
- Testar com endpoints mockados (httpx); asserir que o principal é enviado em cada chamada.
