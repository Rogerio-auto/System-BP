---
id: F14-S06
title: Frontend — botão "Enviar simulação ao cliente"
phase: F14
task_ref: null
status: review
priority: high
estimated_size: S
agent_id: null
claimed_at: 2026-06-11T21:30:08Z
completed_at: 2026-06-11T21:40:24Z
pr_url: null
depends_on: [F14-S05]
blocks: []
labels: []
source_docs:
  - docs/planejamento-2026-06-evolucao.md#épico-b-disparo-de-simulação-por-whatsapp-item-2
  - docs/18-design-system.md
docs_required: true
docs_audience:
  - operador
docs_artifacts:
  - docs/help/guias/crm/enviar-simulacao-whatsapp.mdx
---

# F14-S06 — Frontend: botão "Enviar simulação ao cliente"

## Objetivo

Adicionar, no resultado da simulação manual, um botão **"Enviar ao cliente"** que dispara a mensagem de WhatsApp com os dados da simulação.

## Contexto

Item 2 / Épico B. Depende do backend F14-S05 (`POST /api/simulations/:id/send` + flag).

## Escopo (faz)

- Botão **"Enviar ao cliente"** no resultado da simulação (`SimulatorResult.tsx`) e/ou no detalhe da simulação no CRM (`SimulationDetailModal.tsx`).
  - Habilitado só quando o lead tem telefone e a feature flag `simulations.send.enabled` está ligada (gating — `useFeatureFlag`).
  - Estados: loading ("Enviando…"), sucesso (toast), erro claro (Meta indisponível → mensagem amigável, como no sync-all).
- Hook/api de envio (`features/simulator/api` ou `hooks/simulator`).
- Guia `docs/help/guias/crm/enviar-simulacao-whatsapp.mdx`.

## Fora de escopo (NÃO faz)

- Backend (F14-S05).

## Arquivos permitidos (`files_allowed`)

- `apps/web/src/features/simulator/SimulatorResult.tsx`
- `apps/web/src/features/crm/components/SimulationDetailModal.tsx`
- `apps/web/src/hooks/simulator/**`
- `apps/web/src/features/simulator/__tests__/**`
- `docs/help/guias/crm/enviar-simulacao-whatsapp.mdx`

## Arquivos proibidos (`files_forbidden`)

- `apps/api/**`
- `apps/web/src/features/simulator/SimulatorForm.tsx` (não é necessário; evitar colisão)

## Contratos de entrada

- `POST /api/simulations/:id/send` (F14-S05) + flag `simulations.send.enabled`.

## Definition of Done

- [ ] Botão "Enviar ao cliente" no resultado da simulação, gated por flag + telefone
- [ ] Estados loading/sucesso/erro (mensagem clara quando Meta indisponível)
- [ ] `pnpm --filter @elemento/web typecheck && lint && test -- simulator` verdes
- [ ] Guia criado

## Comandos de validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- simulator
```

## Validação

```powershell
pnpm --filter @elemento/web typecheck
pnpm --filter @elemento/web lint
pnpm --filter @elemento/web test -- simulator
```

## Notas para o agente

- Idempotência: gerar/enviar `Idempotency-Key` no request (evita reenvio em duplo clique).
- Seguir o padrão de gating/erro do sync-all de templates (F13-S08) para consistência.
