---
id: F0-S07
title: docker-compose — validação ponta a ponta
phase: F0
task_ref: T0.2
status: in-progress
priority: high
estimated_size: S
agent_id: backend-engineer
claimed_at: 2026-05-11T00:00:00Z
completed_at: null
pr_url: null
depends_on: [F0-S03, F0-S04, F0-S05, F0-S06]
blocks: []
source_docs:
  - docs/12-tasks-tecnicas.md#T0.2
  - docker-compose.yml
---

# F0-S07 — Compose ponta a ponta

## Objetivo

`docker compose up` sobe `postgres + api + web + langgraph` com health checks verdes e comunicação cross-service funcionando (api consulta DB, langgraph consulta api).

## Escopo

- Validar que builds dos Dockerfiles de produção funcionam.
- Validar que `docker-compose.override.yml` (gerado a partir do `.example`) funciona em modo dev.
- Adicionar script `scripts/check-compose.ps1` que:
  1. Sobe compose
  2. Espera health verde de cada serviço
  3. Faz curls em `/health` (api e langgraph)
  4. Derruba

## Fora de escopo

- Adicionar serviços novos (Redis, etc).

## Arquivos permitidos

- `scripts/check-compose.ps1`
- `scripts/check-compose.sh`
- `docker-compose.yml` (apenas correções de bugs)
- `docker-compose.override.yml.example`

## Definition of Done

- [ ] `docker compose up --build` sobe sem erro
- [ ] Health verde em todos os serviços em ≤ 60s
- [ ] Script `check-compose.ps1` funciona local e em CI
- [ ] PR aberto

## Validação

```powershell
.\scripts\check-compose.ps1
```
