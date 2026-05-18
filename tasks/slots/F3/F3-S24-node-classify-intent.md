---
id: F3-S24
title: Nó classify_intent (prompt versionado)
phase: F3
task_ref: T3.13
status: available
priority: high
estimated_size: M
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S00, F3-S03]
blocks: [F3-S31]
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/01-prd-produto.md
---

# F3-S24 — Nó classify_intent

## Objetivo

Classificar a intenção da mensagem do cliente via LLM, com prompt versionado.
Restringe a saída ao enum de intenções do doc 06 §5.1.

## Escopo

- `app/prompts/pre_attendance_classify.md` — prompt de classificação com header
  YAML (`key`, `version`, `model` — doc 06 §5.5), papel/escopo/restrições + few-shot
  por intenção (catálogo doc 01 / doc 06 §5.1/§5.4).
- `app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`:
  - Usa o `LLMGateway` via `for_role("classifier")` (F3-S00) — modelo barato.
  - Saída validada contra o `Literal` de `current_intent`; valor fora do enum
    → fallback `nao_entendi`.
  - Registra `prompt_key`/`prompt_version` no estado para o `log_decision`.
- Testes com fixtures de mensagem + LLM mockado/determinístico.

## LGPD / Segurança

- O prompt declara restrições do doc 06 §5.6 (a IA não aprova crédito, não vaza
  dados internos, não executa tools fora do lead da conversa).
- Texto do cliente passa por DLP (`app/llm/dlp.py`) antes do gateway.

## Fora de escopo

- Roteamento por intenção (edges — F3-S31). Demais nós.

## Arquivos permitidos

- `apps/langgraph-service/app/prompts/pre_attendance_classify.md`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`
- `apps/langgraph-service/tests/graphs/test_node_classify_intent.py`

## Definition of Done

- [ ] Prompt versionado com header YAML.
- [ ] Saída sempre dentro do enum de intenções; valor inválido → `nao_entendi`.
- [ ] DLP aplicado ao texto do cliente antes do gateway.
- [ ] Testes com fixtures cobrem ≥5 intenções.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact`.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```
