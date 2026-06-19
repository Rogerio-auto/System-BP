---
id: F16-S50
title: Fix histórico conversacional do agente (mensagem nova descartada + assistant truncado)
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: in-progress
priority: critical
estimated_size: M
agent_id: null
claimed_at: 2026-06-19T15:22:28Z
completed_at: null
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

# F16-S50 — Fix histórico conversacional (agente re-saúda / não progride)

## Problema (smoke real 2026-06-19 15:12-15:13)

O agente respondeu, mas a cada turno **repete a mesma saudação** (não progride). Inspeção do estado
persistido (`GET /internal/conversations/:id/state`): `messages = [user "Oi", assistant "Olá! Tudo
bem?", assistant "Olá! Tudo bem?", assistant "Olá! Tudo bem?"]` — as mensagens NOVAS do usuário somem
e o assistant guarda só a 1ª das 4 mensagens.

Duas causas:

1. **`_merge_messages` (load_state.py) descarta a mensagem nova.** `process.py` chama
   `receive_message({}, payload)` → `current = [só a msg nova]` (1 item). Quando `persisted` (histórico
   do DB) é maior que `current`, o else faz `persisted + current[len(persisted):]` = `current[N:]` =
   `[]` → a msg nova é perdida. A IA nunca vê o que o cliente digita; responde sempre ao histórico
   velho → re-saúda.
2. **`agent_turn` persiste só `fin` (1ª mensagem) como conteúdo do assistant.** O histórico vira
   "Olá! Tudo bem?" repetido, sem o "poderia informar seu nome?" — a IA, lendo o próprio histórico,
   acha que ainda não pediu o nome → re-pergunta.

## Escopo (faz)

- `load_state.py::_merge_messages`: corrigir para **`persisted + current`** (current só tem a(s) msg(s)
  nova(s) deste turno, pois receive_message parte de `{}`). Remover a heurística de comprimento.
- `agent_turn.py`: ao fazer `msgs.append({"role":"assistant",...})` (caminhos cap e normal), persistir
  o **conteúdo completo** do reply (parsed_messages juntos), não só `fin` — para a IA enxergar o que
  realmente disse ao cliente.
- Teste **multi-turno** (2 turnos, mesmo conversation_id): turno 1 saúda+pede nome; turno 2 (cliente
  manda nome) → a msg do nome está no histórico e o assistant NÃO repete a saudação; histórico acumula
  user+assistant corretamente.

## Fora de escopo

- get-or-create 500 (não reproduzível; provável transiente pós-restart da api). Registrar como achado.
- Lógica do prompt / regras de negócio.

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/load_state.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`

## Definition of Done

- [ ] `_merge_messages` retorna persisted+current (msg nova nunca descartada)
- [ ] assistant persiste conteúdo completo do reply (não só 1ª msg)
- [ ] Teste multi-turno: histórico acumula user+assistant; sem re-saudação
- [ ] `pytest` + `ruff` + `mypy` verdes
- [ ] PR aberto

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
```
