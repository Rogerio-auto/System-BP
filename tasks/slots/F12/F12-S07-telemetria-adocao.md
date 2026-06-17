---
id: F12-S07
title: Telemetria de adoção de tutoriais (opened/completed) — fase 2
phase: F12
task_ref: docs/21-tutoriais-em-video.md#10
status: done
priority: low
estimated_size: S
agent_id: null
claimed_at: 2026-06-17T04:03:51Z
completed_at: 2026-06-17T04:23:54Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/299
depends_on: [F12-S02]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#10
  - docs/21-tutoriais-em-video.md#9
docs_required: false
docs_audience: []
docs_artifacts: []
---
# F12-S07 — Telemetria de adoção (fase 2)

## Objetivo

Medir quais tutoriais são realmente assistidos: registrar `tutorial_opened` (drawer aberto) e `tutorial_completed` (>90% assistido), reusando a infra de telemetria de docs (F10-S12).

## Contexto

Norma 21 §10. Fora do MVP — só entra depois que o sistema estiver em uso. Os callbacks `onPlay`/`onEnded` do `<VideoTutorial>` (F12-S03) e o evento de abertura do drawer (F12-S04) alimentam os endpoints deste slot.

## Escopo (faz)

- Endpoint(s) de ingestão de evento de tutorial (autenticado, rate-limited), reusando o padrão de `doc_views`.
- Persistência (estender tabela de telemetria de docs ou tabela própria `tutorial_events` — decidir reusando o que já existe em F10-S12).
- Fios no front: `<ContextualHelp>`/drawer disparam `opened`; `<VideoTutorial>` dispara `completed` em `onEnded` (>90%).
- Zod + OpenAPI; sem PII.

## Fora de escopo (NÃO faz)

- Dashboard de métricas (slot futuro, se desejado).
- Mudança no componente de vídeo além de consumir os callbacks já existentes.

## Arquivos permitidos (`files_allowed`)

- `apps/api/src/modules/tutorials/**` (estender)
- `apps/api/src/db/schema/**` + `apps/api/src/db/migrations/**` (se criar `tutorial_events`)
- `apps/web/src/features/help/contextual/**` (disparar eventos)
- `tasks/slots/F12/F12-S07-telemetria-adocao.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/pages/admin/**`, `apps/web/src/features/admin/**`
- telas de feature do app
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S02 (API/módulo), F12-S03 (callbacks), F12-S04 (drawer).

## Contratos de saída

- Eventos de adoção persistidos e consultáveis.

## Definition of Done

- [ ] `opened` e `completed` persistidos sem PII
- [ ] Rate-limit + Zod + OpenAPI
- [ ] `check-migrations` ok se criar tabela
- [ ] typecheck / lint / test verdes (api + web)

## Comandos de validação

```powershell
python scripts/slot.py check-migrations
pnpm --filter @elemento/api test
pnpm --filter @elemento/web test
```

## Notas para o agente

- Preferir **reusar** a telemetria de F10-S12 a criar tabela nova — avaliar primeiro.
- Fase 2: só pegar este slot quando o Rogério priorizar.
