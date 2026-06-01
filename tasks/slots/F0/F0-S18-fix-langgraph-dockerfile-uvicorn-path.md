---
id: F0-S18
title: Fix CI — langgraph Dockerfile não encontra uvicorn em runtime (4ª camada do destrava-CI)
phase: F0
task_ref: F0.18
status: done
priority: critical
estimated_size: S
agent_id: python-engineer
depends_on: []
blocks: []
labels: [ci, infra, dockerfile, langgraph]
source_docs:
  - apps/langgraph-service/Dockerfile
claimed_at: 2026-06-01T10:39:45Z
completed_at: 2026-06-01T10:41:21Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/173
---

# F0-S18 — Fix Dockerfile do langgraph: `uvicorn` não encontrado em $PATH

## Contexto

F0-S17 destravou 3 camadas do bug do CI (shared-schemas TS, imports sem `.js`,
shared-schemas dist/). Com a stack agora subindo mais longe, foi revelada
uma 4ª camada — pré-existente, escondida por todas as anteriores:

### O erro

E2E Smoke do PR #172 (post-merge na main, vai aparecer em todo PR daqui pra frente):

```
Container elemento-ci-langgraph-1  Starting
Error response from daemon: failed to create task for container:
  failed to create shim task: OCI runtime create failed:
  runc create failed: unable to start container process:
  error during container init:
  exec: "uvicorn": executable file not found in $PATH
```

Postgres ✅ Healthy. API ✅ Healthy. **Langgraph nem chega a iniciar.**

### Causa raiz

`apps/langgraph-service/Dockerfile`:

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /build
COPY pyproject.toml ./
RUN pip install --upgrade pip \
 && pip install --target=/deps .          # ← instala módulos em /deps/ e scripts em /deps/bin/

FROM python:3.12-slim
ENV PYTHONPATH=/usr/local/lib/python3.12/site-packages
WORKDIR /app
COPY --from=builder /deps /usr/local/lib/python3.12/site-packages   # ← copia /deps INTEIRO
COPY --chown=app:app app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]   # ← procura uvicorn em $PATH
```

Quando `pip install --target=/deps` é usado, o pip cria:

```
/deps/
├── fastapi/...           ← módulos (encontrados via PYTHONPATH)
├── uvicorn/...
├── starlette/...
└── bin/
    ├── uvicorn           ← script ENTRYPOINT (NÃO está em $PATH no runner stage)
    └── ...
```

O `COPY --from=builder /deps /usr/local/lib/python3.12/site-packages` joga o
`bin/uvicorn` em `/usr/local/lib/python3.12/site-packages/bin/uvicorn` —
caminho que **não está no `$PATH`** do container. O `CMD ["uvicorn", ...]`
falha porque o shim do containerd procura `uvicorn` no `$PATH` antes do exec.

## Objetivo

Destravar o boot do container `langgraph` em produção/CI, sem refatorar todo
o Dockerfile. Mínimo necessário.

## Escopo

Aplicar **uma** das soluções abaixo. Preferência por (1) — mais robusta e
limpa, não depende de scripts shim:

### (1) RECOMENDADO — usar `python -m uvicorn` no CMD

```dockerfile
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`python -m uvicorn` importa o módulo `uvicorn` (achado via PYTHONPATH) e roda
seu entrypoint. Não precisa do bin script. É o pattern canônico para
produção quando se usa `pip install --target=...`.

### (2) Alternativa — copiar `/deps/bin` para `/usr/local/bin`

```dockerfile
COPY --from=builder /deps/bin /usr/local/bin
COPY --from=builder /deps /usr/local/lib/python3.12/site-packages
```

Funciona mas adiciona scripts à área binária do sistema — menos limpo.

### (3) Alternativa — instalar sem `--target`

Trocar `pip install --target=/deps .` por `pip install --user .` ou usar
venv `python -m venv` + `pip install` no venv. Mais invasivo — fora de
escopo aqui.

**Decisão obrigatória no PR:** registrar qual escolheu e por quê.

## Fora de escopo

- Refatoração completa do Dockerfile do langgraph (venv, multi-stage com uv etc).
- Mudanças no `app/main.py` ou no código Python.
- Mudanças no `docker-compose.ci.yml`.
- F8-S18 (UI dos cards Cobrança/Templates) — slot separado, PR #171.

## Arquivos permitidos

- `apps/langgraph-service/Dockerfile`

## Arquivos proibidos

- Qualquer coisa fora do Dockerfile.
- `apps/langgraph-service/pyproject.toml` (a menos que seja necessário —
  registrar a justificativa).
- `apps/api/**`, `apps/web/**`, `packages/**`.

## Definition of Done

- [ ] Container `langgraph` boota saudável no E2E Smoke do CI.
- [ ] Local: `docker build -f apps/langgraph-service/Dockerfile -t elemento-langgraph:test apps/langgraph-service && docker run --rm -p 8000:8000 elemento-langgraph:test` funciona — endpoint `/health` responde 200.
- [ ] CI verde no PR: Node CI + Python CI + E2E Smoke todos PASS.
- [ ] PR documenta a decisão (1, 2 ou 3 acima) e por quê.
- [ ] Nenhuma mudança em código Python.

## Validação

```powershell
# Local (precisa Docker Desktop)
docker build -f apps/langgraph-service/Dockerfile -t elemento-langgraph:test apps/langgraph-service
docker run --rm -d -p 8000:8000 --name lg-test elemento-langgraph:test
Start-Sleep 5
curl http://localhost:8000/health
docker stop lg-test

# Se Docker não estiver disponível local, dependa do CI
```
