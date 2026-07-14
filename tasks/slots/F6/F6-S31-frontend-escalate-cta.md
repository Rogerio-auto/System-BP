---
id: F6-S31
title: Frontend — CTA "Escalar ao Crédito" no card de lead do copiloto (confirmação humana)
phase: F6
task_ref: docs/22-agente-interno-acoes.md
status: done
priority: medium
estimated_size: M
agent_id: null
depends_on: [F6-S30, F6-S22]
blocks: []
labels: [frontend, ai-assistant, design-system]
source_docs: [docs/18-design-system.md, docs/22-agente-interno-acoes.md]
docs_required: false
claimed_at: 2026-07-14T19:42:54Z
completed_at: 2026-07-14T19:55:37Z
---

# F6-S31 — Frontend: CTA de escalação no card de lead

## Objetivo

No card `lead_summary` do copiloto (F6-S22), oferecer o botão **"Escalar ao Crédito"**. O clique abre um
**modal de confirmação** que mostra exatamente o que será enviado e a quem; só o "confirmar" dispara a ação.
A IA **nunca** escala sozinha — o humano é o ator.

## Escopo (faz)

- Botão de ação no `LeadSummaryCard` (Design System; ação secundária, não compete com a leitura do card).
  Visível **apenas** se o usuário tiver a permissão `assistant:escalate` (usar o hook de permissão existente).
- Modal de confirmação (padrão de confirmação já usado no app):
  - Mostra o lead, o destinatário ("Departamento de Crédito — matriz"), e um campo opcional de **nota**.
  - Deixa explícito que é uma **notificação** (não move o lead, não decide crédito).
  - Botões: cancelar / confirmar. Sem confirmação, nada acontece.
- Chamar `POST /api/assistant/escalate` (ler o **Zod real** do F6-S30 — sem drift de contrato).
- Estados: loading, sucesso (feedback claro: "Crédito notificado"), erro (409 sem destinatário e 404 fora de
  escopo com mensagens humanas), e **estado já-escalado** (idempotência: não deixar spammar).
- Sem PII em localStorage/telemetria.

## Fora de escopo (NÃO faz)

- Backend (F6-S30). Novas ações além da escalação.

## Arquivos permitidos

- `apps/web/src/features/assistant/**`
- `apps/web/src/hooks/assistant/**`

## Arquivos proibidos

- `apps/api/**`, `apps/langgraph-service/**`

## Definition of Done

- [ ] CTA no `LeadSummaryCard`, gated por `assistant:escalate`
- [ ] Modal de confirmação humana (mostra lead + destinatário + nota opcional) — sem confirmar, nada dispara
- [ ] Contrato lido do Zod real do F6-S30 (sem drift); loading/sucesso/erro (404, 409)/já-escalado tratados
- [ ] Design System (tokens; nada abaixo de `--text-xs`); sem PII em localStorage
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
- O modal de confirmação é o **eixo de segurança** da primeira ação de escrita do copiloto (doc 22:
  propor → humano confirma). Nunca dispare a ação sem confirmação explícita.
