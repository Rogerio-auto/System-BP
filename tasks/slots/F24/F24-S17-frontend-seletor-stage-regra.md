---
id: F24-S17
title: Frontend — seletor de stage no editor de regra de estagnação
phase: F24
task_ref: docs/planejamento-notificacoes.md
status: review
priority: medium
estimated_size: M
agent_id: null
depends_on: [F24-S16]
blocks: []
labels: [frontend, notifications, admin]
source_docs: [docs/18-design-system.md, docs/23-notificacoes.md]
docs_required: false
claimed_at: 2026-07-10T15:53:05Z
completed_at: 2026-07-10T16:01:23Z
---

# F24-S17 — Frontend: escolher o stage da regra de estagnação

## Objetivo

Quando o Admin escolhe o gatilho `kanban_stage` numa regra de estagnação, permitir selecionar **qual
stage** monitorar (ou "qualquer stage"), gravando `trigger_key` como `kanban_stage:<stageId>` ou
`kanban_stage:*`.

## Contexto

`F24-S16` habilitou `trigger_key` parametrizável por prefixo (`kanban_stage:<stageId>`). Sem este slot,
a UI só consegue criar a regra genérica `kanban_stage:*` ("parado em qualquer stage") — o caso de uso
do planejamento §3 ("card parado em Documentação há 48h") continua inalcançável pelo produto.

O editor vive em `apps/web/src/features/admin/notification-rules/RuleDrawer.tsx`.

## Escopo (faz)

- No `RuleDrawer`, quando o gatilho selecionado for do eixo `kanban_stage`:
  - Renderizar um `Select` de stages do Kanban, com a opção **"Qualquer stage"** (→ `kanban_stage:*`)
    como default, e cada stage da org (→ `kanban_stage:<stageId>`).
  - Ao editar uma regra existente, pré-selecionar o stage a partir do `trigger_key` persistido.
  - Os demais gatilhos não exibem o seletor (sem regressão de layout).
- Carregar os stages via TanStack Query, reusando o hook/endpoint de stages do Kanban já existente
  (procurar em `features/kanban/**` — **não** criar endpoint novo).
- Estado vazio: se a org não tiver stages, exibir a opção "Qualquer stage" e desabilitar o resto,
  sem quebrar o formulário.
- Tokens e componentes do Design System (`docs/18-design-system.md`) — nada de estilo ad-hoc.
- Testes: seletor aparece só no eixo `kanban_stage`; submit monta `trigger_key` correto (`*` e `<stageId>`);
  edição de regra existente pré-seleciona o stage certo.

## Fora de escopo (NÃO faz)

- Backend / validação de `trigger_key` (F24-S16).
- Outros eixos de inatividade (não são parametrizáveis).
- Sino de notificação em tempo real (F24-S13).

## Arquivos permitidos

- `apps/web/src/features/admin/notification-rules/RuleDrawer.tsx`
- `apps/web/src/features/admin/notification-rules/__tests__/RuleDrawer.test.tsx`

## Arquivos proibidos

- `apps/api/**`
- `packages/shared-schemas/**`
- `apps/langgraph-service/**`

## Definition of Done

- [ ] Seletor de stage aparece só quando o gatilho é do eixo `kanban_stage`
- [ ] "Qualquer stage" é o default e grava `kanban_stage:*`
- [ ] Stage específico grava `kanban_stage:<stageId>` (UUID)
- [ ] Edição de regra existente pré-seleciona o stage a partir do `trigger_key`
- [ ] Stages carregados de endpoint existente (nenhum endpoint novo)
- [ ] Tokens do Design System; sem regressão de layout nos outros gatilhos
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
```

## Notas para o agente

- **Não** coloque `python scripts/slot.py validate F24-S17` no bloco Validação (fork bomb — ver F24-S16).
- Ler o schema Zod real de `packages/shared-schemas/src/notification-rules.ts` para montar `trigger_key`
  — não inferir o formato pelo nome do campo (drift de contrato front×API já quebrou `/relatorios`).
- `RuleDrawer` é formulário React Hook Form; o `trigger_key` é um campo único, não dois — monte a string
  no submit, não guarde stage em campo separado no payload.
