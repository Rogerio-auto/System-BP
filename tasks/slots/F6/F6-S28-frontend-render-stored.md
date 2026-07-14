---
id: F6-S28
title: Frontend — abrir conversa do histórico (narrativa + cards hidratados)
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: in-progress
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S27, F6-S22]
blocks: [F6-S29]
labels: [frontend, ai-assistant, design-system]
source_docs: [docs/18-design-system.md, docs/anexos/lgpd/dpia-historico-copiloto.md]
docs_required: false
claimed_at: 2026-07-14T23:18:09Z
---

# F6-S28 — Frontend: abrir conversa do histórico

## Objetivo

Renderizar uma conversa salva: narrativa + cards **hidratados ao vivo** (F6-S27), com placeholder "dado
indisponível" quando o usuário não tem mais acesso. Alimentar a memória de sessão para continuar a conversa.

## Escopo (faz)

- Ao abrir uma conversa do histórico, buscar os turnos + hidratação (F6-S27) e renderizar narrativa + cards
  (reusar os componentes de card do F6-S22).
- Bloco `unavailable` → card "dado indisponível" (tokens do DS), sem quebrar o layout.
- Carregar os turnos hidratados como **histórico de sessão** (F6-S17/S19) para que a conversa continue do
  ponto em que parou.
- Sem PII em localStorage.

## Fora de escopo (NÃO faz)

- Barra lateral (F6-S29). Backend (F6-S27).

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Definition of Done

- [ ] Conversa salva renderiza narrativa + cards hidratados; `unavailable` → placeholder
- [ ] Turnos hidratados alimentam a memória de sessão (continuar a conversa)
- [ ] Tokens do DS; sem PII em localStorage
- [ ] `pnpm --filter @elemento/web typecheck` + `lint` + `test` + `build` verdes

## Notas para o agente

- **Bloqueado até F6-S23.** Não coloque `slot.py validate` no bloco. Ler o Zod real do backend (F6-S27).
