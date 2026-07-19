---
id: F27-S04
title: Frontend — superfícies densas responsivas (tabelas CRM/Relatórios → cards, forms)
phase: F27
task_ref: docs/24-pwa.md
status: available
priority: medium
estimated_size: M
agent_id: null
depends_on: [F27-S03]
blocks: []
labels: [frontend, ux, pwa]
source_docs: [docs/24-pwa.md, docs/18-design-system.md]
docs_required: false
---

# F27-S04 — Superfícies densas responsivas

## Objetivo

Fazer as telas densas (listas/tabelas de CRM e Relatórios, formulários) degradarem bem no mobile —
tabelas viram cards, forms empilham — sob o DS v2, sem regredir o desktop. Depende do shell
responsivo (F27-S03).

## Contexto

Doc 24 §6. As tabelas de CRM e Relatórios são densas e quebram no mobile. Este slot cuida só da
**camada de apresentação** — não tocar hooks de dados nem `api.ts` (contrato front×API vive nos
schemas Zod; ver memória de drift de contrato).

## Escopo (faz)

- Listas/tabelas de CRM (`features/customers`) e Relatórios (`features/relatorios`) degradam para
  cards empilhados em telas pequenas; densas no desktop.
- Primitivo(s) de tabela/card responsivo reusável em `apps/web/src/components/ui/` para não
  duplicar a lógica de "table↔cards".
- Formulários empilham no mobile; modais podem virar sheets full-height quando fizer sentido (DS).
- Alvos de toque ≥44px; foco visível.

## Fora de escopo (NÃO faz)

- Shell/navegação (F27-S03).
- Qualquer `api.ts`, hook de dados ou schema (só apresentação).
- Lógica PWA/SW/push.

## Arquivos permitidos

- `apps/web/src/features/customers/**`
- `apps/web/src/features/relatorios/**`
- `apps/web/src/components/ui/**`
- `apps/web/src/**/*.test.ts`
- `apps/web/src/**/*.test.tsx`

## Arquivos proibidos

- `apps/api/**`
- `apps/langgraph-service/**`
- `apps/web/src/App.tsx`
- `apps/web/src/components/layout/**`
- `packages/**`

## Definition of Done

- [ ] Tabelas de CRM e Relatórios viram cards no mobile e permanecem tabela no desktop
- [ ] Primitivo responsivo reusável em `components/ui/` (sem duplicar table↔cards por tela)
- [ ] Forms empilham no mobile; sem overflow horizontal
- [ ] Nenhum `api.ts`/hook/schema tocado (só apresentação)
- [ ] Tokens do DS v2; foco visível; alvos ≥44px
- [ ] Sem regressão do desktop; `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test
pnpm --filter @elemento/web build
```

## Notas para o agente

- Só apresentação. Não mexer em contrato de dados (memória: drift front×API em paralelo).
- Reusar o primitivo do `components/ui/` nas duas áreas — não copiar a lógica.
  </content>
