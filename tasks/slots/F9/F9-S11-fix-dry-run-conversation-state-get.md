---
id: F9-S11
title: Fix dry-run GET /internal/conversations/:id/state — retorna shape errado
phase: F9
task_ref: hotfix
status: available
priority: high
estimated_size: XS
agent_id: ''
claimed_at: ''
completed_at: ''
pr_url: ''
depends_on: []
blocks: []
labels: []
source_docs:
  - tasks/PROTOCOL.md
  - apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py
---

# F9-S11 — Fix dry-run GET conversation_state retorna shape errado

## Contexto (incidente 2026-05-26)

Auditoria identificou 1 teste vermelho no `langgraph-service`:

```
FAIL tests/graphs/test_dry_run.py::TestDryRunGet::test_get_returns_synthetic_response
AssertionError: assert 'state' in {'dry_run': True, 'ok': True}

Tests: 753 passed | 1 failed | 1 skipped
```

### Causa raiz

`apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py` define o
factory `_stub_conversation_state` (linha ~157):

```python
def _stub_conversation_state(body: dict[str, Any]) -> dict[str, Any]:
    """Stub para POST/PUT /internal/conversations/:id/state -> idempotente."""
    return {"ok": True, "dry_run": True}
```

Esse factory está mapeado em `_PATH_TO_STUB_FACTORY` para o pattern
`^/internal/conversations/[^/]+/state$` **sem distinguir método HTTP**.

`_synthetic_get_response` (linha ~397) consulta o mesmo dicionário e
short-circuita antes do fallback documentado:

```python
@staticmethod
def _synthetic_get_response(path: str) -> dict[str, Any]:
    for pattern, factory in _PATH_TO_STUB_FACTORY.items():
        if pattern.search(path):
            return factory({})       # <-- captura o stub de POST/PUT
    return {"state": {}, "dry_run": True}  # fallback nunca atingido
```

Logo, o GET retorna `{ok, dry_run}` em vez de `{state, dry_run}`, quebrando o
contrato esperado pelo nó `load_state` (que valida a chave `state`).

### Impacto em produção

Regressão real no Playground (F9-S03 / F9-S07): o operador no Manager dispara
`/process/whatsapp/playground` sem `allow_real_reads`, o `DryRunInternalApiClient`
chama `get('/internal/conversations/.../state')` no nó `load_state`, recebe
`{ok, dry_run}`, e o Pydantic do nó rejeita por falta de `state`. O agente cai
no fallback genérico de F3-S34 (LangGraph failure handoff) — UX confusa para
quem está exercitando o agente.

### Origem

F7-S03 (commit `55f1717`, hardening F3 pré-produção) adicionou o factory
centralizado e o caminho de short-circuit. O bloco de comentários no item 10
(`dry_run.py: stub usa uuid4()`) menciona dry_run mas a regressão GET passou
despercebida porque o teste relevante já existia desde F9-S03 e não rodou na
suite mergeada do F7-S03 (CI provavelmente ignorou warning ou pulou o teste).

## Objetivo

`_synthetic_get_response('/internal/conversations/:id/state')` deve retornar
`{"state": {}, "dry_run": True}` (fallback) sem quebrar os comportamentos do
POST/PUT desse mesmo path (que continuam usando `_stub_conversation_state`).

Teste `test_get_returns_synthetic_response` verde sem alterar a asserção.

## Opções (preferência: 1 > 2)

### Opção 1 — Method-aware factory map

Trocar `_PATH_TO_STUB_FACTORY` para um dicionário de método+pattern, ou
introduzir um set separado de "paths que GET deve cair no fallback". Trade-off:
+5 linhas, semântica explícita.

### Opção 2 — Stub `_stub_conversation_state` discrimina método via flag

Passar o método como argumento opcional ao factory; refatorar consumers (POST
em `post()`, PUT em `_request`, GET em `_synthetic_get_response`). Mais
invasivo.

Preferir opção 1.

## Escopo

- Alterar `dry_run.py` para que GET no path `/internal/conversations/:id/state`
  retorne `{"state": {}, "dry_run": True}`.
- Adicionar 1 teste extra cobrindo o caminho contrário (POST/PUT continua
  retornando `{"ok": True, "dry_run": True}`).
- Não tocar nos consumers em `app/graphs/whatsapp_pre_attendance/nodes/`.

## Arquivos permitidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/dry_run.py`
- `apps/langgraph-service/tests/graphs/test_dry_run.py`

## Arquivos proibidos

- `apps/langgraph-service/app/graphs/whatsapp_pre_attendance/nodes/**` — o
  contrato esperado pelos nós é fonte da verdade, não pode mudar.
- `apps/langgraph-service/app/tools/_base.py` — InternalApiClient real está
  correto, não tocar.
- Qualquer mudança em `app/main.py` ou em outras rotas — fix é cirúrgico.

## Definition of Done

- [ ] `pytest tests/graphs/test_dry_run.py -v` verde.
- [ ] `pytest -q` verde (753+ passed, 0 failed).
- [ ] `ruff check app tests` verde.
- [ ] `mypy app` verde.
- [ ] Teste adicional cobre POST/PUT path retornando `{ok, dry_run}` para
      prevenir regressão futura.
- [ ] PR descreve o cenário do Playground (F9-S07) que dispara o bug.

## Validação

```powershell
cd apps/langgraph-service ; uv run ruff check app tests
```

```powershell
cd apps/langgraph-service ; uv run mypy app
```

```powershell
cd apps/langgraph-service ; uv run pytest -q
```

## Notas

- O comentário no `_synthetic_get_response` já dizia "Fallback: load_state e
  outros GET genéricos retornam estado vazio" — a documentação está correta,
  a implementação que regrediu.
- Slot de origem do bug: F7-S03 (`55f1717`). Slot dono do dry-run: F9-S03
  (`9df5a8e`) / F9-S10 (`6c1ff9e`).
