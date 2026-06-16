---
id: F18-S12
title: Frontend — botão "Enviar ao cliente" na simulação (Onda 2 item 2)
phase: F18
task_ref: docs/planejamento-2026-06-evolucao.md#épico-b--disparo-de-simulação-por-whatsapp-item-2
status: review
priority: medium
estimated_size: S
agent_id: null
claimed_at: 2026-06-16T13:37:52Z
completed_at: 2026-06-16T13:46:42Z
pr_url: null
depends_on: [F18-S11]
blocks: []
labels: [frontend, simulation, whatsapp]
source_docs:
  - docs/planejamento-2026-06-evolucao.md
  - docs/18-design-system.md
docs_required: false
---

# F18-S12 — Frontend: botão "Enviar ao cliente" na simulação

## Objetivo

Adicionar botão "Enviar ao cliente" no resultado da simulação manual, que dispara `POST /api/simulations/:id/send` quando habilitado.

## Contexto

Item 2 (Onda 2). Backend pronto (F18-S11). O botão aparece somente quando: (1) o lead tem telefone, (2) a feature flag `simulations.send.enabled` está ativa.

## Escopo (faz)

- Em `SimulationResult.tsx` (ou onde o resultado da simulação é exibido — verificar), adicionar botão "Enviar ao cliente" (ícone WhatsApp + texto).
- Gate: `useFeatureFlag('simulations.send.enabled')` → se false, ocultar o botão.
- Gate: lead tem telefone (`lead.phone` não-null) → se null, mostrar botão desabilitado com tooltip "Lead sem telefone cadastrado".
- Ao clicar: `useSendSimulation(simulationId)` mutation (TanStack Query `useMutation`).
- Loading state no botão durante envio.
- Toast de sucesso: "Simulação enviada via WhatsApp ✓".
- Erro `TEMPLATE_NOT_CONFIGURED`: toast de erro "Template de simulação não configurado. Contate o administrador."

## Fora de escopo (NÃO faz)

- Seleção de template (configuração administrativa).
- Backend (F18-S11).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/simulations/**`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `packages/shared-schemas/**`
- `apps/web/src/features/crm/**`

## Contratos de entrada

- `POST /api/simulations/:id/send` → `200 { message_id }` (F18-S11).
- `useFeatureFlag('simulations.send.enabled')` existente.
- `lead.phone` disponível no contexto da simulação.

## Definition of Done

- [ ] Botão "Enviar ao cliente" visível quando flag ligada e lead tem telefone.
- [ ] Botão desabilitado + tooltip se lead sem telefone.
- [ ] Oculto se flag desligada.
- [ ] Toast de sucesso/erro.
- [ ] DS aplicado (botão com cor do WhatsApp? ou seguir DS — preferir tokens do DS).
- [ ] `pnpm --filter @elemento/web typecheck && lint` verdes.

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
```

## Notas para o agente

- Leia `apps/web/src/features/simulations/` completo antes de editar — identifique onde o resultado da simulação é exibido.
- O pattern de `useFeatureFlag` está em `apps/web/src/hooks/useFeatureFlag.ts` ou similar.
- DS: evite usar verde do WhatsApp explicitamente — use `var(--success)` para o ícone/botão para manter consistência com o DS.
