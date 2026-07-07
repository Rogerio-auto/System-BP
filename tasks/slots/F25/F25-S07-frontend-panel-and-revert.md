---
id: F25-S07
title: Frontend — painel "IA no funil (24h)" + reverter + config de limiares (gated)
phase: F25
task_ref: docs/22-agente-interno-acoes.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F25-S06]
blocks: [F25-S09]
labels: [frontend, ai-agent, rbac, design-system]
source_docs: [docs/22-agente-interno-acoes.md, docs/18-design-system.md]
docs_required: false
---

# F25-S07 — Frontend: painel de ações da IA + reversão

## Objetivo

Superfície visual do doc 22 §11: gestor vê o que a IA fez no funil (24h) e reverte em 1 clique;
admin/gestor_geral configura os limiares. Tudo gated por flag + permissão.

## Escopo (faz)

- Painel "IA no funil" (últimas 24h): lista de ações (qualificou / sinalizou estagnação / abandonou),
  consumindo `GET /api/ai-actions`. Visível só com `ai_actions:read` e flag
  `internal_assistant.actions.enabled` (padrão gating de UI, doc 09 §4.1).
- Botão **Reverter** por item (`POST /api/ai-actions/:id/revert`), visível só com `ai_actions:revert`;
  confirmação + optimistic update + rollback em erro.
- Form de configuração dos limiares (`stagnant_after_days`/`abandon_after_days`), visível só com
  `ai_actions:manage`. (Consome endpoint de config — se ainda não exposto, expor GET/PUT mínimo em
  `apps/api` está fora deste slot; coordenar com F25-S06/S05. Se ausente, entregar só leitura + aviso.)
- Hooks TanStack Query + tokens do Design System (light-first, profundidade). Entrada via `App.tsx`
  (roteador vivo) e/ou card em ConfiguracoesPage.

## Fora de escopo (NÃO faz)

- Backend (F25-S06).
- Artigos de ajuda (F25-S09).

## Arquivos permitidos

- `apps/web/src/features/ai-actions/**`
- `apps/web/src/hooks/ai-actions/**`
- `apps/web/src/App.tsx`
- `apps/web/src/features/configuracoes/ConfiguracoesPage.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Painel IA-24h consumindo `GET /api/ai-actions`, gated por flag + `ai_actions:read`
- [ ] Reverter gated por `ai_actions:revert`, com confirmação + optimistic + rollback
- [ ] Config de limiares gated por `ai_actions:manage`
- [ ] Tokens do DS (doc 18); sem cor/estilo fora dos tokens
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
python scripts/slot.py validate F25-S07
```

## Notas para o agente

- Ler o schema Zod real da API (evitar drift de contrato front×API).
- Ler `docs/18-design-system.md` para tokens/hover/profundidade. Nada de template genérico.
- `useAuth().hasPermission(...)` para gating; flag via `useFeatureFlag`.
