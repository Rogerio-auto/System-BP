---
id: F1-S26
title: LGPD — DLP no pipeline LangGraph (mascaramento antes do gateway OpenRouter)
phase: F1
task_ref: LGPD §8.4 §13
status: in-progress
priority: critical
estimated_size: M
agent_id: claude-code
claimed_at: 2026-05-12T14:58:08Z
completed_at: null
pr_url: null
depends_on: [F0-S06]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/17-lgpd-protecao-dados.md
  - docs/06-langgraph-agentes.md
---

# F1-S26 — DLP no pipeline LangGraph

## Objetivo

Garantir que **nenhum dado pessoal bruto saia do Brasil** via gateway OpenRouter. Implementar a função `redact_pii` canônica, integrá-la como pre-flight obrigatório no `app/llm/gateway.py`, e validar com testes de unidade + integração que cobrem CPF, CNPJ, email, telefone E.164/nacional, RG (heurística) e nome composto.

## Escopo

### `app/llm/dlp.py`

- `redact_pii(text: str) -> Tuple[str, Dict[str, str]]` retorna `(texto_mascarado, reverse_map)`.
- Padrões cobertos:
  - **CPF:** `\d{3}\.?\d{3}\.?\d{3}-?\d{2}`, validando DV. CPF inválido por DV ainda é mascarado (vazamento parcial é vazamento).
  - **CNPJ:** análogo.
  - **Email:** RFC simplificado.
  - **Telefone:** E.164 BR `+55\d{10,11}` + formatos nacionais `(99) 99999-9999`, `99999-9999`.
  - **RG (heurística):** padrões comuns (`\d{1,2}\.\d{3}\.\d{3}-?[\dXx]`) — flag indicando que pode haver falso positivo.
  - **Datas de nascimento:** `\d{2}/\d{2}/\d{4}` quando próximas de termos `nascimento`, `nasc`, `DOB`.
  - **Nome:** _NÃO_ mascarar por padrão. Mascarar apenas se solicitado por `mask_names=True` (assistente interno raramente; agente externo sempre `False` porque o nome é necessário para a interação).
- Tokens estáveis dentro da mesma chamada (mesma CPF → mesmo token `<CPF_1>`).
- `reverse_map` fica em memória do processo, escopado à conversa. **Nunca persistido em log/banco/outbox.**

### `app/llm/gateway.py`

- Função única `complete(messages, *, conversation_id, dlp=True)`:
  - Aplica `redact_pii` em cada mensagem antes de enviar.
  - Loga (structlog) apenas a versão mascarada + contador `pii_tokens_redacted`.
  - Headers padrão OpenRouter (auth, app referer, etc).
- Flag `dlp=False` exige logging warn explícito e só é aceita em fluxo interno autenticado (chamadas vindas de `/internal/*` com `X-Internal-Token` válido + permissão `assistant:bypass_dlp` — não existe ainda, abrir slot se precisar).

### Validador pós-LLM

- Após resposta, validador checa se modelo tentou colar tokens reais (caso de prompt injection / regressão).
- Se resposta contiver padrão de CPF/CNPJ/email/telefone → log de incidente + flag `suspicious_output=true` + truncar resposta.

### Testes

- `tests/llm/test_dlp.py`:
  - Cada padrão coberto com 5+ variações.
  - Texto longo misto com 3 CPFs distintos → tokens distintos, stable mapping.
  - CPF "1234567890" (sem formatação) → mascarado.
  - Email com `+tag` → mascarado.
  - Falso negativo proibido para CPF/CNPJ válido.
- `tests/llm/test_gateway.py`:
  - Mock do httpx para OpenRouter, verifica que payload enviado NÃO contém CPF/email/telefone.
  - `dlp=False` sem permissão → raise.

### Documentação

- `apps/langgraph-service/docs/dlp.md` explicando padrões, limitações, e como adicionar novo padrão.
- Atualizar doc 17 §8.4 marcando o gate como implementado.

## Arquivos permitidos

- `apps/langgraph-service/app/llm/dlp.py`
- `apps/langgraph-service/app/llm/gateway.py`
- `apps/langgraph-service/app/llm/validators.py`
- `apps/langgraph-service/tests/llm/**`
- `apps/langgraph-service/docs/dlp.md`
- `docs/17-lgpd-protecao-dados.md` (marcar §16)

## Definition of Done

- [ ] `redact_pii` cobre 100% dos padrões da spec; cobertura ≥95% no pytest.
- [ ] `gateway.complete` aplica DLP por padrão; teste prova payload sanitizado.
- [ ] Validador pós-LLM detecta vazamento e degrada output.
- [ ] Logs estruturados (structlog) jamais carregam tokens reais.
- [ ] `reverse_map` não escapa do escopo da conversa (revisar passagens por referência).
- [ ] Documentação `dlp.md` atualizada com matriz de padrões.
- [ ] PR com label `lgpd-impact` e checklist do doc 17 §14.2.

## Validação

```powershell
cd apps/langgraph-service
uv run ruff check .
uv run mypy app
uv run pytest -q tests/llm
```
