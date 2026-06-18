---
id: F16-S40
title: Nó agent_turn (LLM tool-calling) + route_conversation + flag novo×funil
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: available
priority: critical
estimated_size: L
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F16-S39, F16-S42]
blocks: [F16-S41, F16-S43]
labels:
  - lgpd-impact
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
  - docs/17-lgpd-protecao-dados.md
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F16-S40 — Nó `agent_turn` + `route_conversation` (B2)

## Objetivo

Substituir o funil determinístico por um **nó agêntico** (`agent_turn`) que roda o LLM com o prompt
`pre_attendance_agent` (carregado do DB) em **loop de tool-calling** (ReAct), até produzir a resposta
do turno. Adicionar `route_conversation` (handoff_active / judicial / normal) e gatear novo×velho por
**feature flag** para go-live seguro.

Coração do Bloco B — `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §2 + §11 (B2).

## Contexto

- Hoje `graph.py` encadeia 13 nós (`classify_intent → identify_lead → … → decide`). Arquitetura errada
  (funil rígido, não responde dúvida no meio). Ver §2 do plano.
- O agente carrega o prompt via `load_active_prompt("pre_attendance_agent")` (loader F9-S09, já existe;
  seedado em F16-S39).
- Tools disponíveis e já com org_id (Bloco A, F16-S38): `leads_tools`, `city_tools`, `simulation_tools`,
  `request_handoff`, `audit_tools`. As tools de negócio evoluídas (simulação com regras, faq_rag,
  consulta_scr) são Bloco C — **este slot acopla as tools que já existem**; as novas entram depois sem
  reescrever o nó.
- LLM via gateway OpenRouter (`app/llm/gateway.py` / `factory.py`) — nunca chamar provider direto.
- DLP (`app/llm/dlp.py`) **antes** de qualquer envio ao gateway (doc 17 §8.4) — nada de PII bruta.

## Escopo (faz)

- Novo nó `nodes/agent_turn.py`:
  - Carrega o prompt ativo (`pre_attendance_agent`) como system message.
  - Monta o contexto: histórico ≤ `MAX_MESSAGES` (já truncado no state) + estado leve (§4) como
    contexto estruturado do que já foi coletado.
  - Roda loop ReAct de tool-calling via gateway, com **cap de tool-calls por turno** (ex.: 4) para
    evitar loop custoso (doc 06 §8 / plano §7).
  - Tools acopladas: as existentes (lead update, identify_city, simulação atual, request_handoff,
    log decision). Schema de cada tool exposto ao modelo via o padrão de `app/tools/_base.py`.
  - Passa todo texto pelo DLP antes do gateway.
  - Produz o estado do turno (mensagens + atualizações de estado leve + handoff/actions). O **contrato
    de saída multi-mensagem `{messages:[...]}`** é formalizado em F16-S41 — aqui, deixar o nó já
    produzindo a lista de mensagens no estado (campo a ser consumido por send_response/B3).
- Novo `route_conversation` (em `routes.py`): decide ANTES do agente —
  - `handoff_active == true` → IA silencia (END / send_response vazio).
  - `collection_status == "legal"` → rota judicial (placeholder de END + handoff; grafo dedicado é
    Bloco E, fora daqui).
  - caso normal → `agent_turn`.
- `graph.py`: **feature flag** (env/settings, ex. `PRE_ATTENDANCE_AGENTIC_ENABLED`) que escolhe entre
  o pipeline agêntico novo (`load_state → route_conversation → agent_turn → send_response → persist →
log`) e o funil antigo (mantido intacto). Default da flag: definir conservador (ver Notas).
- Settings: registrar a flag em `app/settings.py` (ou equivalente) tipada.

## Fora de escopo (NÃO faz)

- Remover/apagar os nós do funil antigo (B5 / F16-S43) — só gatear por flag.
- Contrato/schema multi-mensagem e envio (B3 / F16-S41) — aqui o nó só popula a lista no estado.
- Tools novas: simulação com regras de perfil, faq_rag, consulta_scr (Bloco C).
- Backend Node (`apps/api/**`).
- Seed do prompt (F16-S39).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py` (novo)
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/routes.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/__init__.py`
- `apps/langgraph-service/app/settings.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/state.py` (campos vêm de F16-S42)
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/send_response.py` (B3)
- `apps/langgraph-service/app/tools/**` (tools evoluídas são Bloco C; aqui só consome o que existe)

## Contratos

- Saída do turno: o nó deposita no estado a lista de mensagens (consumida por B3) + atualizações de
  estado leve + `handoff_required`/`actions_emitted`. Não quebrar o `WhatsAppMessageResponse` atual
  enquanto B3 não formaliza o array (manter `reply` funcional via fallback no caminho agêntico).
- Tool-calls usam org_id de `state["organization_id"]` (já threaded).

## Definition of Done

- [ ] `agent_turn` roda loop ReAct com cap de tool-calls, prompt do DB, DLP antes do gateway
- [ ] `route_conversation` cobre handoff_active / legal / normal
- [ ] Flag gateia novo×funil em `graph.py`; funil antigo intacto quando flag off
- [ ] Tools existentes acopladas e chamáveis pelo agente (org_id correto)
- [ ] Fallback para handoff em erro/timeout do gateway (doc 06 §1.8/§4.4)
- [ ] Testes: turno feliz (responde), turno com tool-call, handoff_active silencia, erro→handoff
- [ ] LGPD §14.2 checklist no PR (LLM/DLP é gatilho lgpd-impact)
- [ ] `pytest` + `ruff check app` + `mypy app` verdes
- [ ] PR aberto com link para o slot

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
.\.venv\Scripts\python.exe -m mypy app
```

## Notas para o agente

- **Flag default:** começar **off** (funil antigo continua sendo o caminho live) até B3+testes (B/D)
  fecharem — o go-live agêntico é ligar a flag depois de validado. Registrar isso no PR.
- O prompt é a fonte da verdade do comportamento (regras de negócio = guardrails). Não duplicar regra
  de negócio em código que o prompt já cobre; o nó é o motor, o prompt é a política.
- Reaproveitar padrões de chamada ao gateway já usados pelos nós atuais (classify/qualify) para tom,
  timeout e tratamento de erro consistentes.
