---
id: F3-S00
title: LLM Gateway — abstração OpenRouter + fallback Anthropic/OpenAI
phase: F3
task_ref: T3.0
status: available
priority: critical
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F0-S06]
blocks: [F3-S15, F3-S18, F3-S19]
source_docs:
  - docs/06-langgraph-agentes.md
---

# F3-S00 — LLM Gateway

## Objetivo
Camada única para o LangGraph chamar LLMs. **OpenRouter é o default** (1 chave, qualquer modelo, billing unificado, sem vendor lock-in). Mantém Anthropic/OpenAI diretos como fallback configurável.

## Por que OpenRouter
- Trocar de modelo é mudança de string (`anthropic/claude-sonnet-4` → `openai/gpt-4o`), sem mexer em código.
- Modelos de classificação baratos (Haiku, Gemini Flash) e modelos de raciocínio caros usam o mesmo cliente.
- Permite versionar `model_id` em `prompt_versions` sem refatorar.
- Headers obrigatórios pelo OpenRouter (`HTTP-Referer`, `X-Title`) já vêm do `config.py`.

## Escopo
- `apps/langgraph-service/app/llm/gateway.py`:
  ```python
  class LLMGateway(Protocol):
      async def complete(
          self,
          *,
          model: str,
          messages: list[dict],
          tools: list[dict] | None = None,
          temperature: float = 0.2,
          max_tokens: int = 1024,
          metadata: dict | None = None,  # vai pra log/tracing
      ) -> LLMResponse: ...
  ```
- `apps/langgraph-service/app/llm/openrouter.py` — usa `langchain-openai` apontando para `OPENROUTER_BASE_URL`, injeta `HTTP-Referer` e `X-Title`.
- `apps/langgraph-service/app/llm/anthropic.py` — usa `langchain-anthropic` direto (fallback opcional).
- `apps/langgraph-service/app/llm/factory.py` — `get_gateway()` lê `settings.llm_provider` e retorna instância.
- Helper `for_role(role: Literal["classifier", "reasoner", "fallback"]) -> str` retorna `model_id` configurado.
- Wrap em retry com backoff (tenacity) e timeout duro.
- Métricas: tokens in/out, latência, custo estimado por chamada → log estruturado.
- Verificação de orçamento diário antes de chamar (consulta tabela `llm_usage_daily` — schema simples criado aqui).
- Testes:
  - Mock OpenRouter responde JSON, gateway parseia.
  - Erro 429 retenta com backoff.
  - Orçamento estourado → `BudgetExceededError`.

## Fora de escopo
- Streaming (pós-MVP).
- Cache de respostas idênticas (slot futuro).

## Arquivos permitidos
- `apps/langgraph-service/app/llm/**`
- `apps/langgraph-service/app/db/schema_llm_usage.sql` (DDL aplicada via backend, conferir com F1-S01)
- Atualizar `apps/langgraph-service/pyproject.toml` com `langchain-openai`, `langchain-anthropic`, `tenacity`.

## Definition of Done
- [ ] Trocar `LLM_PROVIDER` entre `openrouter` e `anthropic` funciona sem mudar código de nó
- [ ] `for_role("classifier")` retorna modelo barato; `"reasoner"` retorna Sonnet/equivalente
- [ ] Headers `HTTP-Referer` e `X-Title` enviados em toda chamada OpenRouter
- [ ] Orçamento diário bloqueia chamadas com erro claro
- [ ] Testes verdes
- [ ] PR aberto
