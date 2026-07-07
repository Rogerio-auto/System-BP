---
id: F25-S04
title: Python — tool qualify_lead no agente + fiação no agent_turn + prompt
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: high
estimated_size: M
agent_id: null
depends_on: [F25-S03]
blocks: []
labels: [python, langgraph, ai-agent, dlp]
source_docs: [docs/22-agente-interno-acoes.md, docs/06-langgraph-agentes.md]
docs_required: false
---

# F25-S04 — Python: tool qualify_lead (Ana Clara)

## Objetivo

Dar à Ana Clara a capacidade de **afirmar** que coletou o dossiê mínimo e qualificar o lead,
chamando o endpoint de F25-S03. A IA nunca escolhe stage — só sinaliza o fato.

## Contexto

Skill `/langgraph-agent` carrega as pegadinhas (org_id threading, DLP, opcional vazio → 400).
Doc 22 §6.1: qualificar quando houver nome completo + cidade válida no escopo + atividade +
intenção de crédito.

## Escopo (faz)

- Tool `qualify_lead(lead_id, reason)` em `apps/langgraph-service/app/tools/leads_tools.py`,
  chamando `POST /internal/leads/:id/qualify` via httpx (mesmo padrão das tools existentes).
  `organization_id` vem do state (threading), não do LLM. Retorno estruturado `{ok, status}`.
- Registrar o schema da tool em `_build_tool_schemas()` e o dispatch em `agent_turn.py`
  (`apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`).
- Guard de feature flag: se `internal_assistant.actions.enabled` desligada, a tool retorna
  `FEATURE_DISABLED` estruturado e o grafo segue graciosamente (doc 22 §10; doc 09 §4.4).
- Atualizar o prompt `apps/langgraph-service/app/prompts/pre_attendance_agent.md`: quando e como
  qualificar (dossiê mínimo), e que ela **não** decide crédito nem move o card manualmente.

## Fora de escopo (NÃO faz)

- Endpoint /internal (F25-S03, já pronto).
- Ações proativas (F25-S05).
- Novas tools além de `qualify_lead`.

## Arquivos permitidos

- `apps/langgraph-service/app/tools/leads_tools.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`
- `apps/langgraph-service/app/prompts/pre_attendance_agent.md`
- `apps/langgraph-service/tests/test_qualify_lead_tool.py`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/**`

## Definition of Done

- [ ] Tool `qualify_lead` implementada, tipada (mypy strict), `organization_id` do state
- [ ] Schema registrado + dispatch no `agent_turn`; cap de tool-calls respeitado
- [ ] Flag OFF → `FEATURE_DISABLED` estruturado, sem quebrar o turno
- [ ] Prompt atualizado (quando qualificar; não decide crédito)
- [ ] `ruff check .` + `mypy app` + `pytest -q` verdes

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
python scripts/slot.py validate F25-S04
```

## Notas para o agente

- DLP: nunca confiar em PII vinda do arg; usar dados do state. `reason` sem PII bruta.
- Opcional vazio `""` dá 400 no /internal — omitir campos ausentes.
- Testar com o serviço mockado (httpx) — não depender de API real no pytest.
