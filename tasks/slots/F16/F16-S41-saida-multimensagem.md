---
id: F16-S41
title: Saída estruturada {messages:[...]} (≤300) + envio multi-mensagem
phase: F16
task_ref: docs/planejamento-fluxo-conversacional-pre-atendimento.md
status: review
priority: critical
estimated_size: M
agent_id: python-engineer
claimed_at: 2026-06-18T18:53:16Z
completed_at: 2026-06-18T19:37:09Z
pr_url: null
depends_on: [F16-S40]
blocks: []
labels: []
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/planejamento-fluxo-conversacional-pre-atendimento.md
docs_required: false
docs_audience: []
docs_artifacts: []
---
# F16-S41 — Saída estruturada multi-mensagem (B3)

## Objetivo

Formalizar o contrato de saída do agente como **`{messages: [...]}`** (array de mensagens curtas,
soma ≤ 300 chars, sem `\n`) e fazer o `send_response` emitir cada mensagem separadamente, refletindo
no `WhatsAppMessageResponse` (doc 06 §4.2) consumido pelo worker.

Bloco B do `docs/planejamento-fluxo-conversacional-pre-atendimento.md` §6 + §11 (B3).

## Contexto

- Hoje `ReplyPayload` (`schemas/outbound.py`) tem `content: str` (1 string). O agente Ana Clara produz
  um **array** de mensagens curtas (estilo digitação natural). O nó `agent_turn` (F16-S40) já deposita
  a lista no estado; este slot a transporta até a resposta HTTP.
- **Cross-service:** o consumidor é o worker `livechat-ai.ts` (apps/api), que hoje envia `reply.content`
  como 1 mensagem. Para evitar drift de contrato (risco conhecido do projeto), este slot **adiciona um
  campo `messages: list[str]`** ao response mantendo `reply` válido (retrocompat), e o ajuste do
  consumidor para iterar o array é dependência registrada (sibling backend slot — ver Notas). O agente
  preenche os dois (reply.content = primeira msg ou join curto; messages = array completo) até o
  consumidor migrar.

## Escopo (faz)

- `schemas/outbound.py`: adicionar `messages: list[str]` ao `WhatsAppMessageResponse` (ou ao
  `ReplyPayload`), com validação Pydantic: cada item não-vazio, **sem `\n`**, e **soma total ≤ 300**.
- `nodes/send_response.py`: ler a lista de mensagens do estado (produzida pelo agente), validar/truncar
  conforme regra, e popular `messages` + manter `reply` retrocompatível.
- Validação de borda (Pydantic) e teste do limite de 300 chars e da ausência de `\n`.
- Garantir que, no caminho do funil antigo (flag off), o comportamento atual (`reply.content`) não muda.

## Fora de escopo (NÃO faz)

- Lógica de raciocínio do agente (F16-S40).
- Mudança no worker `livechat-ai.ts` (apps/api) — sibling slot backend (ver Notas).
- Tools de negócio (Bloco C).

## Arquivos permitidos

- `apps/langgraph-service/app/schemas/outbound.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/send_response.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/graph.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/agent_turn.py`

## Contratos

- `WhatsAppMessageResponse` (doc 06 §4.2): novo `messages: list[str]`. Regra: `1 <= len(item)`,
  `"\n" not in item`, `sum(len) <= 300`. `reply` permanece válido (retrocompat com o worker atual).

## Definition of Done

- [ ] `messages: list[str]` no response com validação (não-vazio, sem `\n`, soma ≤ 300)
- [ ] `send_response` popula `messages` a partir do estado do agente; `reply` retrocompatível
- [ ] Funil antigo (flag off) inalterado
- [ ] Testes: array válido, soma > 300 (trunca/erro definido), item com `\n` rejeitado
- [ ] `pytest` + `ruff check app` + `mypy app` verdes
- [ ] PR aberto com link para o slot; nota sobre o sibling slot do worker

## Comandos de validação

```powershell
cd apps/langgraph-service
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check app
.\.venv\Scripts\python.exe -m mypy app
```

## Notas para o agente

- **Sibling backend (não neste slot):** o worker `livechat-ai.ts` precisa iterar `messages` e enviar
  cada uma separadamente (como o n8n fazia, ARQUITETURA §2.8). Registrar como achado no PR para abrir
  slot backend; até lá o `reply.content` retrocompatível mantém o fluxo funcionando.
- Definir explicitamente o comportamento quando a soma passa de 300: preferir o modelo já respeitar
  (instruído no prompt), mas a borda deve ter fallback determinístico (truncar a última msg) — sem
  cortar no meio de palavra quando viável.
