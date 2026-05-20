---
id: F9-S10
title: Hardening do runtime do agente — DLP gateway + dry_run_sink + mensagens de erro
phase: F9
task_ref: T9.10
status: available
priority: critical
estimated_size: M
agent_id: python-engineer
claimed_at:
completed_at:
pr_url:
depends_on: [F3-S24, F9-S03]
blocks: []
labels: [lgpd-impact]
source_docs:
  - docs/06-langgraph-agentes.md
  - docs/12-tasks-tecnicas.md
  - docs/17-lgpd-protecao-dados.md
---

# F9-S10 — Hardening do runtime do agente

## Objetivo

Corrigir 3 bugs revelados durante o primeiro teste E2E real do agente (via playground, 2026-05-20). O mais grave é **pré-existente desde F3-S24** e quebra TODO processamento de mensagem WhatsApp em produção real; só não foi detectado antes porque os testes mockam o gateway.

## Contexto

Em 2026-05-20 o orquestrador subiu o LangGraph e disparou um POST real ao `/process/whatsapp/playground`. O dry-run completou (status 200) mas o trace expôs 3 erros runtime:

1. **`classify_intent`**: `NotImplementedError: dlp=False not yet permitted — open slot to implement assistant:bypass_dlp` — TODO turno de classificação cai em handoff.
2. **`request_handoff`** (após CRITICO-1 acima): erro Pydantic `1 validation error for ChatwootNoteOutput note_id Field required` — o stub do `dry_run_sink` retorna payload incompatível.
3. **`request_handoff`** com `lead_id` ausente (esperado em modo sintético): mensagem `"lead_id ausente — handoff requer lead identificado"` pouco informativa no contexto de playground.

## Escopo

### CRÍTICO-1: classify_intent quebra produção real

`apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py:236` passa `"dlp": False` ao `gateway.complete()`. Justificativa do código: "DLP já aplicado manualmente acima" (linha 202 chama `redact_pii(user_text)`).

O gateway (`apps/langgraph-service/app/llm/openrouter.py:109-121` e `anthropic.py` equivalente) levanta `NotImplementedError` quando `dlp=False` porque a permissão `assistant:bypass_dlp` não foi implementada.

**Resultado em produção:** `await gateway.complete(...)` em classify_intent levanta `NotImplementedError` → cai no `except Exception` (linha 278) → `handoff_required=True` com motivo "dlp=False not yet permitted". TODO turno de classificação dispara handoff. Os testes não detectam porque mockam `get_gateway` com `AsyncMock` que aceita qualquer kwarg.

**Solução recomendada (mais simples e correta):** remover `"dlp": False` do `complete_kwargs` em todos os nós que fazem DLP manual antes. Justificativa: `redact_pii` é idempotente sobre tokens já mascarados (regex de CPF não casa com `<CPF_1>`). Aplicar DLP duas vezes é no-op.

- Linha 236 de `classify_intent.py`: remover a key `"dlp": False`.
- Buscar outros nós com mesmo padrão (`grep -rn '"dlp": False' apps/langgraph-service/app/graphs/`).
- Remover o branch `if not dlp: raise NotImplementedError` em `openrouter.py:109-121` e `anthropic.py:106-128`, OU manter como defesa em profundidade e nunca chamar com `dlp=False` desde o código de produção.
  - **Decisão recomendada:** manter o branch (defesa contra futuras regressões) + alterar todos os callers para usar default `dlp=True`. Quando a permissão `assistant:bypass_dlp` for implementada (slot futuro), reativar o branch via flag de usuário.

**Testes obrigatórios:** ao menos 1 teste de integração que execute `classify_intent` com gateway real (`respx` interceptando HTTP, igual ao F9-S08 fix de top_p). Asserta que a chamada chega ao OpenRouter — não no `NotImplementedError`. **O teste DEVE falhar antes do fix** — prove rodando contra o código atual primeiro.

### CRÍTICO-2: dry_run_sink retorna payload incompleto para ChatwootNoteOutput

`apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py` — o `DryRunInternalApiClient` intercepta POST/PATCH/PUT e retorna payloads sintéticos. Para `POST /internal/chatwoot/notes`, o stub retorna algo como `{"id": "uuid", "status": "ok", "dry_run": True}`, mas o consumer (`request_handoff.py`) espera `ChatwootNoteOutput` que exige campo `note_id`. Pydantic levanta `Field required`.

**Solução:** mapear cada path interno (POST/PATCH/PUT) ao schema canônico esperado pelo caller e retornar payload válido. Fontes da verdade são os schemas de output das tools em `apps/langgraph-service/app/tools/*.py`. Lista mínima a cobrir:

- `POST /internal/chatwoot/notes` → `{"note_id": "<uuid>", "dry_run": True}` (ou estrutura completa do `ChatwootNoteOutput`).
- `POST /internal/handoffs` → estrutura completa de `HandoffOutput`.
- `POST /internal/leads/get-or-create` → estrutura mínima de `LeadOutput`.
- `PATCH /internal/leads/:id/profile` → idempotente.
- `POST /internal/simulations` → `SimulationOutput` com `simulation_id`.
- `POST /internal/ai/decisions` → `{"decision_log_id": "<uuid>"}`.
- `PUT /internal/conversations/:id/state` → idempotente.
- `POST /internal/conversations/:id/state` (criação) → estado mínimo.

**Centralize** num dict `_PATH_TO_STUB_FACTORY: dict[str, Callable[[dict], dict]]` para evitar `if/elif` espalhado. Cada factory recebe o request body e retorna o dict sintético com `dry_run: True` marcado.

### MEDIUM: mensagem de erro pouco informativa no playground

Quando o operador roda playground sem `lead_id` e o grafo aciona `request_handoff`, a mensagem `"lead_id ausente — handoff requer lead identificado"` aparece no trace. Em playground sintético isso é **esperado** — não é falha real. Melhorar:

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/request_handoff.py:170`: detectar se está em dry-run via flag no state (`state.get("dry_run") == True`) e usar mensagem contextual:
  ```
  "Modo sintético sem lead identificado — em produção o lead seria criado antes "
  "do handoff. Para testar handoff completo, selecione um lead real no playground."
  ```
- Para o caminho de produção (não dry-run), manter a mensagem atual.
- Definir como o `dry_run` flag chega no state: o `playground.py` precisa setar `state["dry_run"] = True` no payload inicial passado a `build_graph().invoke()`. Ajuste em `apps/langgraph-service/app/api/playground.py`.

## RBAC / Segurança / LGPD

- Label `lgpd-impact` (CRÍTICO-1 envolve regra inviolável LGPD §8.4 sobre DLP no pipeline LLM).
- Defesa em profundidade: gateway mantém o branch `if not dlp: raise NotImplementedError` como guard contra regressão futura.
- DLP idempotente: confirmar que `redact_pii(redact_pii(text)) == redact_pii(text)` para textos com tokens estáveis (testar em `tests/llm/test_dlp.py`).

## Fora de escopo

- Implementação da permissão `assistant:bypass_dlp` (slot futuro quando houver caso de uso real — internal assistant ou admin com flag explícita).
- Outros bugs do dry-run não revelados ainda (cobertura E2E mais ampla — backlog).
- Migração de prompts in-code → DB (F9-S09 — slot separado).

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/classify_intent.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/qualify_credit_interest.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/generate_simulation.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/request_handoff.py`
- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py`
- `apps/langgraph-service/app/api/playground.py`
- `apps/langgraph-service/tests/graphs/test_classify_intent.py`
- `apps/langgraph-service/tests/graphs/test_request_handoff.py` (criar se não existe)
- `apps/langgraph-service/tests/graphs/test_dry_run.py` (existente — adicionar casos)
- `apps/langgraph-service/tests/api/test_playground.py` (existente — adicionar casos E2E)
- `apps/langgraph-service/tests/llm/test_dlp.py` (existente — adicionar teste de idempotência)
- `apps/langgraph-service/tests/llm/test_classify_intent_integration.py` (criar — teste com `respx` que falharia antes do fix)

## Definition of Done

- [ ] `grep -rn '"dlp": False' apps/langgraph-service/app/graphs/` retorna ZERO ocorrências.
- [ ] Novo teste de integração de `classify_intent` com gateway real via `respx` passa; testar manualmente que o teste falhava antes do fix.
- [ ] `DryRunInternalApiClient` tem mapa explícito `_PATH_TO_STUB_FACTORY` cobrindo os 8 paths listados.
- [ ] Teste de integração que roda o grafo real com cenários que disparam `chatwoot_notes` e `handoffs` valida que os schemas pydantic dos outputs aceitam o payload do stub.
- [ ] `request_handoff` usa mensagem contextual quando `state["dry_run"] == True`.
- [ ] Teste do playground (`tests/api/test_playground.py`) verifica que `state["dry_run"] = True` é passado para o grafo.
- [ ] `redact_pii` idempotente testado.
- [ ] `ruff check`, `mypy app`, `pytest -q` verdes.
- [ ] PR com label `lgpd-impact` + checklist §14.2.

## Validação

```powershell
cd apps/langgraph-service ; ruff check . ; mypy app ; pytest -q
python scripts/slot.py validate F9-S10
```
