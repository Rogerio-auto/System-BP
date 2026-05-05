---
id: F0-S01
title: Verificar e travar lockfiles (pnpm + python)
phase: F0
task_ref: T0.1
status: done
priority: critical
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-05T00:00:00Z
completed_at: 2026-05-05T00:00:00Z
pr_url: null
depends_on: []
blocks: [F0-S02, F0-S03, F0-S05, F0-S06]
source_docs:
  - docs/12-tasks-tecnicas.md#T0.1
---

# F0-S01 — Verificar e travar lockfiles

## Objetivo
Garantir reprodutibilidade total das instalações: `pnpm install --frozen-lockfile` funciona em CI desde o dia um, e o serviço Python tem `requirements.lock` com hashes.

## Contexto
A estrutura do monorepo já está criada com `package.json` em todos os workspaces e `pyproject.toml` no serviço Python. Falta gerar e commitar os lockfiles.

## Escopo
- Rodar `pnpm install` no root e commitar `pnpm-lock.yaml`.
- Em `apps/langgraph-service`, gerar `requirements.lock.txt` via `pip-compile --generate-hashes` (ou equivalente com `uv pip compile`).
- Validar `pnpm install --frozen-lockfile` em terminal limpo.

## Fora de escopo
- Adicionar novas dependências.
- Alterar versões fixadas em `package.json` ou `pyproject.toml`.

## Arquivos permitidos
- `pnpm-lock.yaml`
- `apps/langgraph-service/requirements.lock.txt`

## Arquivos proibidos
- Qualquer `package.json`, `pyproject.toml` (versões já decididas).

## Contratos de saída
- `pnpm install --frozen-lockfile` passa.
- `pip install -r apps/langgraph-service/requirements.lock.txt --require-hashes` passa.

## Definition of Done
- [x] `pnpm-lock.yaml` commitado e verde em CI
- [x] `requirements.lock.txt` commitado com hashes
- [x] CI workflow `.github/workflows/ci.yml` continua passando
- [ ] PR aberto

## Notas pós-review
- Security review: 🟡 APROVADO COM RESSALVAS.
- **M1 (não-bloqueante):** `requirements.lock.txt` foi compilado com Python 3.13 (header do arquivo) — projeto exige `>=3.12`. Recomendado regenerar em container `python:3.12-slim` antes do primeiro deploy real. Encaminhar como nota técnica para o próximo slot Python que tocar `apps/langgraph-service/`.

## Validação
```powershell
pnpm install --frozen-lockfile
cd apps/langgraph-service ; pip install -r requirements.lock.txt --require-hashes
```
