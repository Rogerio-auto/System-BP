---
id: F16-S45
title: Testes conversacionais do agent_turn por cenário (validação pré go-live)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: done
priority: critical
estimated_size: M
agent_id: null
claimed_at: 2026-06-18T20:26:45Z
completed_at: 2026-06-18T20:50:35Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/335
depends_on: [F16-S40]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
  - apps/langgraph-service/app/prompts/pre_attendance_agent.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S45 — Testes conversacionais do agente (Bloco D — validação)

## Objetivo

Validar o nó `agent_turn` (F16-S40) end-to-end por cenário, com gateway LLM e tools `/internal`
mockados, cobrindo os fluxos do prompt Ana Clara. É o gate automatizado antes do flip da flag e do
smoke manual em staging do Rogério.

Bloco D do `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §8/§11 (testes conversacionais).

## Contexto

- `agent_turn` roda loop ReAct chamando o gateway (`app/llm/gateway.py`) e despachando tools existentes
  (`leads_tools`, `city_tools`, `simulation_tools`, `request_handoff`, `audit_tools`) via
  `_dispatch_tool`. Já há testes unitários (F16-S40); este slot adiciona **cobertura por cenário** de
  conversa, validando a orquestração + a saída multi-mensagem (F16-S41).
- Estratégia: mockar o gateway para retornar a sequência de tool-calls / mensagem final de cada cenário,
  e mockar o `InternalApiClient` (respostas das tools). Asserções sobre: tools chamadas, estado leve
  atualizado, `messages[]` produzido (≤300, sem `\n`), handoff quando esperado.
- **Simulação usa o engine existente** (ver [[feedback_simulacao_usa_engine_existente]]): o cenário de
  simulação mocka `/internal/simulations` retornando parcela+total; o teste assere que o agente NÃO
  expõe % de taxa ao cliente e informa avalista quando valor ≤ R$ 5.000.

## Escopo (faz)

Cenários (no mínimo) como testes pytest em `apps/langgraph-service/tests/`:

1. **Saudação / primeiro contato** — agente se identifica como IA e pede nome (sem chamar tool de
   crédito ainda).
2. **Pede simulação** — agente chama `generate_credit_simulation` (mock do engine), responde só
   parcela+total (sem %), informa avalista se ≤ R$5k, e segue pedindo cidade/nome.
3. **Porto Velho** — `identify_city` retorna cidade não atendida → agente explica cordialmente, sem
   simular.
4. **Currículo/vaga** — agente faz handoff imediato (`request_handoff`).
5. **Boleto/financeiro** — handoff prioridade.
6. **handoff_active = true** — IA silencia (sem chamar gateway; `route_conversation`).
7. **Erro/timeout do gateway** — fallback para handoff (não trava, não responde vazio).
8. **Cap de tool-calls** — batch grande não excede o cap (reforço do fix de hardening).
9. **org_id vazio** — handoff antes de qualquer chamada (reforço do hardening).

## Fora de escopo (NÃO faz)

- Código de produção (`app/**`) — este slot é só testes (`tests/**`). Se um cenário expõe bug, abrir
  slot de fix separado e registrar no PR.
- SCR (botão) e RAG (faq_rag) — deferidos para 2ª onda.
- Testes do worker Node (F16-S44, sibling).

## Arquivos permitidos

- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/langgraph-service/app/**`
- `apps/api/**`

## Definition of Done

- [ ] Os 9 cenários acima cobertos por testes determinísticos (gateway + InternalApiClient mockados)
- [ ] Asserção-chave de negócio: simulação nunca expõe % de taxa; avalista informado quando ≤ R$5k
- [ ] `messages[]` validado (≤300, sem `\n`) nos cenários que respondem ao cliente
- [ ] handoff coberto (currículo, boleto, handoff_active, erro de gateway, org_id vazio)
- [ ] `pytest -q` + `ruff check app` + `mypy app` verdes
- [ ] PR aberto com link para o slot; quaisquer bugs encontrados registrados como achado

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```

## Notas para o agente

- Reaproveitar os helpers de mock já usados em `tests/graphs/test_node_agent_turn.py` (F16-S40) para
  consistência. Não duplicar fixtures — extrair se necessário dentro de `tests/`.
- O comportamento de negócio (não mostrar %, avalista, Porto Velho, currículo→handoff) é governado pelo
  PROMPT; aqui validamos que, dado o prompt + as tool-responses mockadas, o agente se comporta. Onde o
  comportamento depender de o LLM "decidir", mocke a decisão do gateway e teste a orquestração do nó
  (não a inteligência do modelo).
