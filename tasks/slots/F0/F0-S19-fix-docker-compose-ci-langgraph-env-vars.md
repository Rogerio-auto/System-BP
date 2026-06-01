---
id: F0-S19
title: Fix CI — alinhar env vars do langgraph no docker-compose.ci.yml (5ª camada)
phase: F0
task_ref: F0.19
status: in-progress
priority: critical
estimated_size: XS
agent_id: backend-engineer
depends_on: []
blocks: []
labels: [ci, infra, docker-compose, langgraph]
source_docs:
  - docker-compose.ci.yml
  - apps/langgraph-service/app/config.py
  - .env.example
claimed_at: 2026-06-01T10:53:07Z
---

# F0-S19 — Alinhar env vars do langgraph no `docker-compose.ci.yml`

## Contexto

F0-S18 destravou o boot do uvicorn no langgraph (4ª camada do CI). Com o
container subindo, foi revelada a **5ª camada** — pré-existente, escondida
pelas anteriores: o `docker-compose.ci.yml` passa env vars com nomes
**desviantes** do nome canônico que o resto do codebase usa.

### O erro

```
langgraph-1 | pydantic_core._pydantic_core.ValidationError: 2 validation errors for Settings
langgraph-1 |   Field required [type=missing, input_value={'LOG_LEVEL': 'ERROR'}, input_type=dict]
langgraph-1 |   Field required [type=missing, input_value={'LOG_LEVEL': 'ERROR'}, input_type=dict]
```

Postgres ✅ API ✅ Langgraph **boota e crash em runtime**. Pydantic Settings
só recebeu `LOG_LEVEL` — todas as outras vars do compose foram ignoradas
porque os nomes não batem com os `validation_alias` do `Settings`.

### Causa raiz

`apps/langgraph-service/app/config.py:16-23`:

```python
environment: str = Field(default="development", validation_alias="NODE_ENV")
log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
backend_internal_url: HttpUrl = Field(validation_alias="BACKEND_INTERNAL_URL")  # REQUIRED
internal_token: SecretStr = Field(validation_alias="LANGGRAPH_INTERNAL_TOKEN")  # REQUIRED
```

`docker-compose.ci.yml:88-95` passa:

```yaml
environment:
  ENVIRONMENT: test # ❌ Settings espera NODE_ENV
  LOG_LEVEL: ERROR # ✅ bate
  API_BASE_URL: http://api:3333 # ❌ Settings espera BACKEND_INTERNAL_URL
  INTERNAL_TOKEN: ci-... # ❌ Settings espera LANGGRAPH_INTERNAL_TOKEN
  E2E_MOCK_MODE: 'true' # (não está no Settings — provavelmente lido em outro lugar)
```

### Confirmação de inconsistência (não há risco de cascata)

`docker-compose.ci.yml` é o **único** arquivo desviante. Codebase inteiro usa
os nomes canônicos:

| Var desviante (compose CI)      | Var canônica               | Confirmação de canonicidade                                                                                                                                    |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE_URL`                  | `BACKEND_INTERNAL_URL`     | `.env.example`, `config.py`, `dev.ps1`, `README.md`, `tests/conftest.py`, `F0-S06.md`                                                                          |
| `INTERNAL_TOKEN` (do langgraph) | `LANGGRAPH_INTERNAL_TOKEN` | 72 arquivos: api inteira (routes, handlers, tests, workers, `lib/auth/internal-token.ts`), `.env.example`, `ci.yml`, `e2e.yml`, runbook 19, doc arquitetura 02 |
| `ENVIRONMENT`                   | `NODE_ENV`                 | api inteira                                                                                                                                                    |

Curiosamente o próprio `docker-compose.ci.yml` linha 56 (env do api) **já usa
`LANGGRAPH_INTERNAL_TOKEN` corretamente**. O api foi atualizado em alguma
refatoração; o langgraph ficou pra trás.

`API_BASE_URL` aparece **APENAS no compose CI** — em mais nenhum arquivo do
repo. Ninguém lê. Zero risco de cascata. Mesma análise para `ENVIRONMENT` no
contexto do langgraph.

Sobre `INTERNAL_TOKEN`: a string aparece em 4 testes do api como **string
literal interna** (mock de header HTTP), não como env var lida da `process.env`.
Tests do api não são afetados.

## Objetivo

Alinhar 3 linhas do `docker-compose.ci.yml` para usar os nomes canônicos.
Não tocar em nada além disso.

## Escopo

Em `docker-compose.ci.yml`, seção `langgraph.environment` (linhas 88-95):

```yaml
# ANTES
environment:
  ENVIRONMENT: test
  LOG_LEVEL: ERROR
  API_BASE_URL: http://api:3333
  INTERNAL_TOKEN: ci-internal-token-for-e2e-tests-only-32chars
  E2E_MOCK_MODE: 'true'

# DEPOIS
environment:
  NODE_ENV: test
  LOG_LEVEL: ERROR
  BACKEND_INTERNAL_URL: http://api:3333
  LANGGRAPH_INTERNAL_TOKEN: ci-internal-token-for-e2e-tests-only-32chars
  E2E_MOCK_MODE: 'true'
```

> **Token bate entre api e langgraph**: o api já passa
> `LANGGRAPH_INTERNAL_TOKEN: ci-internal-token-for-e2e-tests-only-32chars`
> (linha 56). O langgraph valida com o mesmo valor — agora ambos
> compartilharão a mesma string com o mesmo nome.

### Verificação de `E2E_MOCK_MODE`

`E2E_MOCK_MODE: 'true'` não está em `config.py` como campo do Settings —
provavelmente é lido em outro lugar (`app/main.py` ou similar). Verifique
que o nome bate antes de fechar; se for usado, ok. Se ninguém ler, deixar
como está (não é o bug em foco).

## Fora de escopo

- Mudar o `config.py` do langgraph para aceitar outros nomes (anti-padrão —
  o codebase canoniza esses nomes; é o compose que deve se ajustar).
- Mudar env vars de `api` ou `postgres` no compose.
- Refatorar o `docker-compose.dev.yml` (não está afetado pelo CI Smoke).
- F8-S18 (UI dos cards Cobrança/Templates) — slot separado, PR #171.

## Arquivos permitidos

- `docker-compose.ci.yml`

## Arquivos proibidos

- Tudo o resto.

## Definition of Done

- [ ] 3 env vars renomeadas em `docker-compose.ci.yml` no serviço `langgraph`.
- [ ] CI verde no PR: Node CI + Python CI + **E2E Smoke** ambos PASS.
- [ ] PR documenta a confirmação de que renomeação não cascateia em nenhum
      outro arquivo (já investigado, mas registrar evidência no PR).
- [ ] Sem outras mudanças.

## Validação

```powershell
# Confirma que API_BASE_URL não é lido por ninguém:
# (esperado: apenas docker-compose.ci.yml na linha que vamos editar)
grep -rn "API_BASE_URL" --include="*.ts" --include="*.py" --include="*.yml" --include="*.json"

# Confirma que BACKEND_INTERNAL_URL e LANGGRAPH_INTERNAL_TOKEN são canônicos:
grep -rn "BACKEND_INTERNAL_URL" .env.example apps/langgraph-service
grep -rn "LANGGRAPH_INTERNAL_TOKEN" apps/api/src/config

# CI faz o resto.
```
