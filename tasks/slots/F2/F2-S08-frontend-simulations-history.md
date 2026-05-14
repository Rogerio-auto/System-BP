---
id: F2-S08
title: Frontend histórico de simulações na ficha do lead
phase: F2
task_ref: T2.7
status: done
priority: medium
estimated_size: S
agent_id: frontend-engineer
claimed_at:
completed_at: 2026-05-14T22:37:29Z
pr_url: https://github.com/Rogerio-auto/System-BP/pull/58
depends_on: [F2-S04, F1-S12]
blocks: []
labels: []
source_docs:
  - docs/18-design-system.md
  - docs/05-modulos-funcionais.md
---

# F2-S08 — Histórico de simulações na ficha do lead

## Objetivo

Adicionar uma seção "Simulações" na `CrmDetailPage` (F1-S12) que lista todas as simulações
do lead, com badge de versão de regra. Clicar em uma simulação abre detalhe (modal ou
drawer) com a tabela de amortização.

## Escopo

### Endpoint consumido

`GET /api/leads/:id/simulations` — slot bonus pode ser necessário no backend. **Se ainda
não existe**, criar parte deste slot dentro de `apps/api/src/modules/simulations/routes.ts`
(é o único arquivo backend permitido aqui). Endpoint deve listar por `lead_id` ordenado
por `created_at DESC`, retornando `{ id, productId, productName, amount, termMonths,
monthlyPayment, ruleVersion, origin, createdAt }`.

> Nota: se o frontend-engineer não puder mexer no backend deste slot, abrir sub-slot
> F2-S08a para o endpoint. Reportar.

### UI — seção "Simulações" no `/crm/:id`

Adicionar abaixo da seção "Dados pessoais" ou em coluna lateral (decisão visual no PR):

- Header: "Simulações" (Bricolage) + contagem + botão "Nova simulação" (link para
  `/simulator?leadId=:id` ou abre drawer F2-S06).
- Lista de cards compactos (Card `elev-2`, hover Spotlight):
  - Linha 1: `R$ 2.500 em 12x de R$ 234,56` (JetBrains Mono pros valores)
  - Linha 2 (caption): `Microcrédito básico · v3 · Price · há 2 dias · IA` (origem)
  - Badge `IA`/`Manual`/`Import` no canto.
- Empty: caption "Nenhuma simulação ainda. Clique em Nova simulação para começar."

### Modal/drawer detalhe da simulação

- Abre ao clicar no card.
- Reutilizar `AmortizationTable` de F2-S06 (component compartilhado — mover para
  `apps/web/src/components/credit/AmortizationTable.tsx` se ainda estiver em features).
- Mostrar: parcela, total, juros, taxa aplicada, tabela completa.
- Botão "Fechar" + "Nova simulação".

### Estados

- Loading: skeleton de 2 cards.
- Empty: caption discreto + CTA.

### Acesso

- Permissão `simulations:read` (já existe em F2-S04 seed).

## Arquivos permitidos

- `apps/web/src/features/crm/CrmDetailPage.tsx` (adicionar seção; cuidado pra não quebrar timeline existente)
- `apps/web/src/features/crm/components/SimulationHistory.tsx`
- `apps/web/src/features/crm/components/SimulationDetailModal.tsx`
- `apps/web/src/features/crm/components/__tests__/SimulationHistory.test.tsx`
- `apps/web/src/components/credit/AmortizationTable.tsx` (mover de F2-S06 se já existir; senão criar aqui)
- `apps/web/src/hooks/crm/useLeadSimulations.ts`
- `apps/web/src/hooks/crm/types.ts` (adicionar `LeadSimulation` type)
- `apps/api/src/modules/simulations/routes.ts` (adicionar `GET /api/leads/:id/simulations`)
- `apps/api/src/modules/simulations/__tests__/routes.test.ts` (test do GET)

> Esse slot toca BACKEND + FRONTEND. Engenheiro escolhido pode ser frontend (com endpoint
> pequeno) ou pode-se quebrar em F2-S08a (backend) + F2-S08b (frontend). Decidir no PR.

## Definition of Done

- [ ] `GET /api/leads/:id/simulations` retorna histórico paginado (mais recentes primeiro).
- [ ] City scope respeitado (lead fora do escopo → 403).
- [ ] Seção "Simulações" aparece no `/crm/:id` com cards compactos.
- [ ] Clicar abre modal com tabela de amortização.
- [ ] Badge de origem (`IA`/`Manual`/`Import`) e versão de regra (`v3`) visíveis.
- [ ] Empty state amigável.
- [ ] Não quebra timeline de interações existente.
- [ ] Funciona em ambos os temas.
- [ ] Tests: lista renderiza, modal abre/fecha, hook chama endpoint correto.
- [ ] PR com screenshots.

## Validação

```powershell
pnpm --filter @elemento/api test -- simulations
pnpm --filter @elemento/web test -- crm
pnpm lint
pnpm typecheck
pnpm build
```
