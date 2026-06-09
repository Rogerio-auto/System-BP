---
id: F12-S06
title: Instrumentar telas do app com <ContextualHelp featureKey>
phase: F12
task_ref: docs/21-tutoriais-em-video.md#7
status: blocked
priority: low
estimated_size: M
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F12-S04, F12-S05]
blocks: []
source_docs:
  - docs/21-tutoriais-em-video.md#7
  - docs/21-tutoriais-em-video.md#4
docs_required: false
docs_audience: []
docs_artifacts: []
---

# F12-S06 — Instrumentar telas com ajuda contextual

## Objetivo

Plugar o `<ContextualHelp featureKey>` nas telas principais do app, garantindo que cada `feature_key` usada existe no catálogo. O ⓘ só aparecerá quando o admin cadastrar o tutorial correspondente.

## Contexto

Norma 21 §7. Este slot é puramente fiação: insere o componente nos headers das funcionalidades e completa o catálogo de `feature_key` (§4.1) com as keys realmente usadas. Nenhuma lógica de negócio muda.

## Escopo (faz)

- Inserir `<ContextualHelp featureKey="...">` nos headers/ações das telas: CRM (lista/kanban/criar/importar), análise de crédito, follow-up, cobrança, templates, simulador, configurações.
- Adicionar ao catálogo `packages/shared-types/src/featureKeys.ts` as keys que faltarem (S01 já criou o arquivo).
- Sem mudança de layout além de posicionar o ⓘ conforme convenção do DS.

## Fora de escopo (NÃO faz)

- Cadastrar tutoriais (o admin faz via UI; conteúdo não é deste slot).
- Mudar lógica/estado das telas.
- Criar novos componentes (usar `<ContextualHelp>` de F12-S04).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/crm/**` (apenas inserir `<ContextualHelp>` nos headers)
- `apps/web/src/features/credit-analyses/**` (idem)
- `apps/web/src/features/followup/**` (idem)
- `apps/web/src/features/billing/**` (idem)
- `apps/web/src/features/templates/**` (idem)
- `apps/web/src/features/simulator/**` (idem)
- `apps/web/src/features/configuracoes/**` (idem)
- `packages/shared-types/src/featureKeys.ts` (apenas adicionar keys faltantes)
- `tasks/slots/F12/F12-S06-instrument-app-pages.md`

## Arquivos proibidos (`files_forbidden`)

- `apps/web/src/features/help/**`, `apps/web/src/features/admin/**`
- `apps/api/**`
- qualquer arquivo de lógica/serviço dentro das features (tocar **só** os componentes de página/header)
- `tasks/STATUS.md`

## Contratos de entrada

- F12-S04: `<ContextualHelp>`. F12-S05: admin para cadastrar (validação manual end-to-end).

## Contratos de saída

- Telas principais prontas para exibir o ⓘ assim que houver tutorial ativo.

## Definition of Done

- [ ] `<ContextualHelp>` nos headers das telas principais
- [ ] Catálogo de feature_key cobre as keys usadas
- [ ] Nenhuma regressão de layout/lógica
- [ ] `pnpm --filter @elemento/web typecheck` / `lint` / `test` / `build` verdes

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web build
```

## Notas para o agente

- Use a skill `regression-guard` antes de editar as telas — não reverter fix recente.
- Posicione o ⓘ de forma discreta (ao lado do título da seção), sem empurrar layout.
