---
id: F6-S20
title: LangGraph — resposta estruturada do copiloto (narrativa sem PII + blocos referenciados)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: L
agent_id: null
depends_on: [F6-S18]
blocks: [F6-S21, F6-S23]
labels: [langgraph, ai-assistant, lgpd-impact, architecture]
source_docs: [docs/22-agente-interno-acoes.md, docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
claimed_at: 2026-07-14T14:56:15Z
completed_at: 2026-07-14T17:07:27Z
---

# F6-S20 — LangGraph: resposta estruturada (narrativa + blocos)

## Objetivo

Reformular a saída do copiloto para separar **narrativa sem PII** de **blocos de dados referenciados por
entidade**. É a Fase 1 do histórico persistente (DPIA `docs/anexos/lgpd/dpia-historico-copiloto.md`) — e um
ganho de UX por si só (dados organizados). **Não persiste nada**; por isso está fora do portão do DPO
(liberada em paralelo).

## Contexto

Hoje o `agent_node` devolve `answer` (texto livre) com nome/cidade crus embutidos. Para o histórico não
guardar PII, o dado de cliente precisa virar **referência de entidade** (de qual lead veio), não valor.

## Escopo (faz)

- Mudar a saída do grafo de `{ answer }` para um contrato estruturado:
  - `narrative: str` — comentário/estrutura **sem PII** (ex.: "lead em pré-qualificação, aguardando análise").
  - `blocks: list[Block]` — cada bloco = `{ type, ref, value }`:
    - `type`: `lead_summary` | `funnel_metrics` | `lead_count` | `analysis_status` | `billing`.
    - `ref`: `{ kind: 'lead'|'none', lead_id?: str }` — **a referência para hidratação futura**.
    - `value`: dado hidratado **apenas para exibição imediata** (será DESCARTADO na persistência da Fase 2).
  - `sources: list[str]` — mantém.
- O agente deve **manter na narrativa apenas texto sem PII** e mover os dados de cliente (nome, cidade, CPF,
  valores) para os `blocks` (que carregam a referência da entidade + o valor corrente). A instrução disso
  entra no prompt (slot separado se necessário) — aqui garanta a ESTRUTURA de saída e a extração de refs a
  partir dos IDs das tool calls (determinístico, não heurístico).
- `dlp=True` inalterado. Nada logado com PII.

## Fora de escopo (NÃO faz)

- Persistência (Fase 2). Endpoint Node (F6-S21). Frontend (F6-S22).
- Continua **read-only**.

## Arquivos permitidos

- `apps/langgraph-service/app/api/internal_assistant.py`
- `apps/langgraph-service/app/graphs/internal_assistant/state.py`
- `apps/langgraph-service/app/graphs/internal_assistant/nodes/agent_node.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`, `apps/web/**`, `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/**`

## Definition of Done

- [ ] Saída do grafo = `{ narrative, blocks:[{type, ref, value}], sources }`
- [ ] `ref` deriva dos IDs das tool calls (lead_id), não de heurística de texto
- [ ] Narrativa sem PII; dados de cliente nos blocks; `value` separável do `ref`
- [ ] `dlp=True` mantido; `content`/PII nunca logados
- [ ] Retrocompat: `AssistantQueryResponse` ainda expõe um `answer` derivável (narrativa + blocos renderizados) para não quebrar chamadas antigas durante a transição — documentar
- [ ] `ruff check .` + `mypy app` + `pytest -q` verdes

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- A separação `ref` (persistível, sem PII) vs `value` (efêmero) é o coração do desenho — mantenha-os campos
  distintos. Skill `/langgraph-agent`.
- Este slot NÃO persiste; é seguro rodar antes do parecer do DPO (ver DPIA §status).
