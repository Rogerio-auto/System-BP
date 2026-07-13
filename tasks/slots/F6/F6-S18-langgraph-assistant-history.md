---
id: F6-S18
title: LangGraph — copiloto usa histórico da sessão nas mensagens do LLM
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: review
priority: high
estimated_size: S
agent_id: null
depends_on: [F6-S07]
blocks: []
labels: [langgraph, ai-assistant, lgpd-impact]
source_docs: [docs/22-agente-interno-acoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-13T13:06:38Z
completed_at: 2026-07-13T13:16:06Z

---
# F6-S18 — LangGraph: histórico nas mensagens do copiloto

## Objetivo

Fazer o `agent_node` do copiloto incluir o **histórico dos turnos** (recebido do endpoint) nas mensagens
enviadas ao LLM, dando memória de sessão. DLP preservada (nenhum PII bruto ao LLM).

## Contexto

`agent_node.py` monta hoje `messages = [{system}, {user: question}]` (linhas ~136-138) — sem histórico.
O request chega em `AssistantQueryRequest(BaseModel, extra="forbid")` (`app/api/internal_assistant.py`) e o
state é `InternalAssistantState` (TypedDict, `app/graphs/internal_assistant/state.py`).
O Node (F6-S17) passa a mandar `history` no payload — **`extra="forbid"` REJEITA campo novo**, então tem que
declarar `history` no modelo.

Contrato EXATO (o que o Node manda): `history: list[{ role: 'user'|'assistant', content: str }]`, opcional,
máx 10.

## Escopo (faz)

- **`AssistantQueryRequest`**: adicionar `history: list[HistoryTurn] | None = None`, com `HistoryTurn`
  Pydantic (`role: Literal['user','assistant']`, `content: str` max 4000). Máx 10 (validar/truncar).
- **`InternalAssistantState`**: adicionar `history` (mesma forma) para threading do endpoint ao node.
- **Fiar** o `history` do request → state (no ponto onde `question`/`principal` são colocados no state).
- **`agent_node`**: montar `messages = [{system}, *history, {user: question}]` — histórico ENTRE o system
  prompt e a pergunta atual. Continuar com **`dlp=True`** (a DLP redige PII de TODAS as mensagens, inclusive
  o histórico, antes do OpenRouter).
- Truncar defensivamente para os últimos 10 turnos se vier mais (mesmo o Node já capando).
- **Nunca logar** o `content` do histórico (só tamanhos/contagem, como já é com `question`).

## Fora de escopo (NÃO faz)

- Node/endpoint (F6-S17). Frontend (F6-S19). Persistência entre sessões.

## Arquivos permitidos

- `apps/langgraph-service/app/api/internal_assistant.py`
- `apps/langgraph-service/app/graphs/internal_assistant/state.py`
- `apps/langgraph-service/app/graphs/internal_assistant/nodes/agent_node.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/**`

## Definition of Done

- [ ] `AssistantQueryRequest` aceita `history` (Pydantic, extra="forbid" não quebra); `InternalAssistantState` carrega
- [ ] `agent_node` monta `[system, *history, user]`; continua `dlp=True`
- [ ] Truncamento defensivo aos últimos 10; sem history = comportamento atual (compat)
- [ ] `content` do histórico nunca logado
- [ ] Testes: com history (messages incluem o histórico na ordem certa), sem history (compat), truncamento
- [ ] `ruff check .` + `mypy app` + `pytest -q` verdes

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- `mypy strict` — type hints em tudo. Skill `/langgraph-agent` tem as pegadinhas.
- O histórico é `role: user|assistant` (nunca `system` — o system prompt é sempre o v2 do banco). Se um item
  vier com role inválido, o Pydantic rejeita (bom).
- LGPD: o histórico pode ter PII em `content` (respostas citam dados de lead). `dlp=True` redige antes do LLM;
  nunca logar `content`. Esse é o eixo do slot.
