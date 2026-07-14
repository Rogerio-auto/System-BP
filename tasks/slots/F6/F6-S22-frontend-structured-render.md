---
id: F6-S22
title: Frontend — render de resposta estruturada (narrativa + cards de dados)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: L
agent_id: null
depends_on: [F6-S21]
blocks: [F6-S27]
labels: [frontend, ai-assistant, design-system]
source_docs: [docs/18-design-system.md, docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
---

# F6-S22 — Frontend: render estruturado (narrativa + cards)

## Objetivo

Renderizar a resposta estruturada do copiloto: a **narrativa** em markdown + **cards de dados** tipados
(um por bloco), usando o `value` hidratado da resposta. Base visual dos dados organizados e da futura
hidratação de histórico.

## Escopo (faz)

- Consumir o novo contrato `{ narrative, blocks:[{type, ref, value}], sources }` (ler o Zod real de F6-S21).
- Renderizar `narrative` com o `AssistantMarkdown` já existente.
- Para cada `block`, renderizar um **card** por `type` (`lead_summary`, `funnel_metrics`, `lead_count`,
  `analysis_status`, `billing`) a partir do `value`. Componentes no Design System (tokens, sem estilo cru).
- Um card genérico de fallback para `type` desconhecido (forward-compat).
- Estados de bloco sem valor / "dado indisponível" já previstos no componente (usados de verdade na Fase 3).
- Manter o comportamento de sessão (memória) e os chips.

## Fora de escopo (NÃO faz)

- Persistência/histórico (Fases 2–4). Backend (F6-S21).

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Arquivos proibidos

- `apps/api/**`, `apps/langgraph-service/**`

## Definition of Done

- [ ] Narrativa + cards por tipo renderizados a partir do contrato estruturado
- [ ] Cards no Design System (tokens; nada abaixo de `--text-xs`); fallback para tipo desconhecido
- [ ] Estado "dado indisponível" no componente de card (para a Fase 3)
- [ ] Sem PII em localStorage; memória de sessão preservada
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- **Não** coloque `slot.py validate` no bloco Validação (fork bomb). Não rode `taskkill python`.
- Ler o Zod real de `internal-assistant/schemas.ts` (F6-S21) — sem drift. DS é lei (doc 18).
- Este slot não persiste; liberado antes do parecer do DPO.
