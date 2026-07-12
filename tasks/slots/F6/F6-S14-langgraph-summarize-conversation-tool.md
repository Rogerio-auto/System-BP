---
id: F6-S14
title: LangGraph — tool de resumo de conversa do lead no copiloto (read-only, DLP)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S13, F6-S16]
blocks: [F6-S15]
labels: [langgraph, ai-assistant, lgpd-impact]
source_docs: [docs/22-agente-interno-acoes.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
claimed_at: 2026-07-12T17:00:11Z
completed_at: 2026-07-12T17:11:16Z
---

# F6-S14 — LangGraph: tool de resumo da conversa do lead

## Objetivo

Adicionar ao copiloto uma tool **read-only** que busca as mensagens da conversa de um lead (via o endpoint
de F6-S13) para o LLM resumir — mantendo o padrão DLP (nenhum PII bruto ao LLM).

## Contexto

As tools do copiloto estão em `apps/langgraph-service/app/tools/assistant_tools.py`:

- `build_assistant_tool_schemas()` declara os schemas expostos ao LLM (hoje 4: funnel-metrics, lead-count,
  analysis-status, billing-upcoming);
- funções `call_*` despacham para os endpoints `/internal/assistant/*` via `InternalApiClient`.
  O `agent_node` já chama o LLM com `dlp=True` (LGPD §8.4) — o gateway redige PII antes do OpenRouter.

## Escopo (faz)

Duas tools novas que o LLM **encadeia** (fluxo agêntico): o usuário nomeia o lead → `find_lead` resolve →
`summarize_lead_conversation` resume. Se `find_lead` retorna vários, o LLM pergunta qual; se nenhum, avisa.

- **`find_lead`** (busca por nome):
  - Schema: descrição ("Use para localizar o lead pelo NOME quando o usuário se refere a um lead por nome"),
    parâmetro `name` (string).
  - `call_*`: `POST /internal/assistant/lead-search` (F6-S16) com `name`; retorna candidatos
    `[{ lead_id, name, city_name }]` + `truncated`. A tool devolve os candidatos ao LLM (não escolhe sozinha).
- **`summarize_lead_conversation`**:
  - Schema: descrição ("Use quando o usuário pedir para resumir a conversa de um lead, com o `lead_id`
    obtido via find_lead"), parâmetro `lead_id` (string/uuid).
  - `call_*`: `POST /internal/assistant/lead-conversation` (F6-S13) com `lead_id`, devolve as mensagens;
    o **LLM resume** (a tool retorna as mensagens ao loop de tool-calling, não resume ela mesma).
- Fiar as duas no dispatch de tools do `agent_node` (onde as outras `call_*` são roteadas).
- **DLP:** nada especial a fazer além de garantir que o fluxo continua com `dlp=True` (já é o caso). O texto
  das mensagens passa pela redação do gateway antes do LLM. **Nunca** logar o `content` das mensagens.
- Erro do endpoint (404 fora de escopo, 403) → retornar ao LLM uma mensagem de tool graciosa (padrão já
  existente: `{"error": ..., "message": "tool execution failed"}`), sem vazar detalhe.

## Fora de escopo (NÃO faz)

- O endpoint (F6-S13). Frontend (F6-S12). Prompt (F6-S15).
- Escrita/ação — esta tool é estritamente leitura.

## Arquivos permitidos

- `apps/langgraph-service/app/tools/assistant_tools.py`
- `apps/langgraph-service/app/graphs/internal_assistant/nodes/agent_node.py`
- `apps/langgraph-service/tests/**`

## Arquivos proibidos

- `apps/api/**`
- `apps/web/**`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/**`

## Definition of Done

- [ ] Tools `find_lead` (→ F6-S16) e `summarize_lead_conversation` (→ F6-S13) no schema + `call_*`
- [ ] Ambas fiadas no dispatch do `agent_node`; continua com `dlp=True`
- [ ] `content` das mensagens e `name` da busca nunca logados; erro de endpoint tratado graciosamente
- [ ] Testes: os 2 schemas expostos, cada `call_*` despacha certo (mock do InternalApiClient), erro tratado
- [ ] `ruff check .` + `mypy app` + `pytest -q` verdes

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Skill `/langgraph-agent` tem as pegadinhas (threading do principal, DLP, contrato de tool). O `lead_id`
  vem do arg do LLM; o principal (org/city/permissions) já está threaded no state — o endpoint aplica o RBAC.
- Read-only: a tool NUNCA escreve. Mantém o copiloto como consultor.
