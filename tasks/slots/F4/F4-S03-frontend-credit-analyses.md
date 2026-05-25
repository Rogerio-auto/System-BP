---
id: F4-S03
title: Frontend — lista, detalhe, form e nova versão de análise de crédito
phase: F4
task_ref: T4.3
status: in-progress
priority: high
estimated_size: L
agent_id: frontend-engineer
claimed_at: 2026-05-25T15:51:13Z
completed_at: null
pr_url: null
depends_on: [F4-S02, F1-S08, F1-S12, F8-S08]
blocks: []
labels: []
source_docs:
  - docs/05-modulos-funcionais.md
  - docs/18-design-system.md
---

# F4-S03 — Frontend de análise de crédito

## Objetivo

Dar ao analista uma UI direta para criar análise a partir de uma simulação, registrar pareceres versionados e decidir aprovação/recusa — substituindo o registro disperso no Notion.

## Escopo

- Página `/credit-analyses` — lista paginada com filtros (status, cidade, analista, período)
- Página `/credit-analyses/:id` — detalhe com timeline de versões + ações (nova versão, decidir, request review)
- Componente `<CreditAnalysisForm>` — form de criação (linka a um lead/simulação existente)
- Componente `<CreditAnalysisVersionTimeline>` — exibe histórico imutável de versões
- Tab "Análise" dentro da página de detalhe do lead (`/leads/:id`) — atalho para análise vigente
- Hooks TanStack Query: `useCreditAnalysesList`, `useCreditAnalysis`, `useCreateCreditAnalysis`, `useAddVersion`, `useDecideAnalysis`, `useRequestReview`
- Diff visual entre versão N e N-1 do parecer (texto colorido linha a linha)
- Estados visuais para os 5 status com cores do Design System (`docs/18-design-system.md`):
  - `em_analise` → tom neutro/info
  - `pendente` → âmbar (atenção)
  - `aprovado` → verde (Rondônia)
  - `recusado` → vermelho
  - `cancelado` → cinza muted

### Regras de UI

- Form usa React Hook Form + Zod (mesma schema do backend, importada via shared)
- Botão "Nova versão" abre modal com textarea grande + checklist de pendências
- Botão "Decidir" aparece **somente** se permissão `credit_analyses:decide` e status atual permitir transição
- Botão "Pedir revisão" aparece para titular/agente conforme permissão `credit_analyses:request_review`
- Toda lista respeita city-scope automaticamente (backend filtra; frontend mostra badge "Sua cidade: Porto Velho")
- Loading skeletons + empty states + erro toast com mensagem do backend

## LGPD

- Parecer exibido em frontend **nunca** é editado em-place — sempre via modal de nova versão
- Anexos exibidos como cards com `filename`, `size`, `sha256` (8 chars) — sem URL clicável até implementar signed URL (slot futuro)
- Componente respeita `pino.redact` no client side (sem logar parecer no console)

## Fora de escopo

- Upload físico de anexo (slot futuro de storage)
- Exportação PDF do parecer (pós-launch)
- Dashboard agregado de análises (F8 já cobre KPIs gerais; refinamento por análise é pós-launch)

## Arquivos permitidos

```
apps/web/src/features/credit-analyses/CreditAnalysesListPage.tsx
apps/web/src/features/credit-analyses/CreditAnalysisDetailPage.tsx
apps/web/src/features/credit-analyses/components/CreditAnalysisForm.tsx
apps/web/src/features/credit-analyses/components/CreditAnalysisVersionTimeline.tsx
apps/web/src/features/credit-analyses/components/CreditAnalysisStatusBadge.tsx
apps/web/src/features/credit-analyses/components/CreditAnalysisDiff.tsx
apps/web/src/features/credit-analyses/hooks/useCreditAnalyses.ts
apps/web/src/features/credit-analyses/api.ts
apps/web/src/features/credit-analyses/schemas.ts
apps/web/src/features/credit-analyses/index.ts
apps/web/src/features/leads/components/LeadCreditAnalysisTab.tsx
apps/web/src/app/router.tsx
apps/web/src/app/navigation.ts
```

## Definition of Done

- [ ] 2 rotas registradas (`/credit-analyses`, `/credit-analyses/:id`)
- [ ] Tab "Análise" adicionada na ficha do lead
- [ ] Filtros funcionais (debounced) e paginação
- [ ] Botões de ação respeitam permissões (hook `useHasPermission`)
- [ ] Timeline de versões imutável e ordenada DESC
- [ ] Diff visual entre versões usa biblioteca leve (`diff` package, já no projeto) — sem nova dep
- [ ] Design System aplicado (tokens, cores da bandeira, profundidade); reprovar review se houver hex hardcoded
- [ ] Empty state, loading skeleton, erro tratado
- [ ] Testes de componente para form + timeline + diff (Vitest + RTL)

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- credit-analyses
pnpm --filter @elemento/web build
```
