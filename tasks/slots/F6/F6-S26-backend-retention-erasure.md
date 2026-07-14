---
id: F6-S26
title: Backend — retenção (90d) e exclusão do histórico do copiloto
phase: F6
task_ref: docs/anexos/lgpd/dpia-historico-copiloto.md
status: available
priority: medium
estimated_size: S
agent_id: null
depends_on: [F6-S24]
blocks: []
labels: [backend, worker, lgpd-impact]
source_docs: [docs/anexos/lgpd/dpia-historico-copiloto.md, docs/17-lgpd-protecao-dados.md]
docs_required: false
---

# F6-S26 — Backend: retenção e exclusão

## Objetivo

Purga automática do histórico do copiloto por prazo (padrão 90 dias, a confirmar no parecer) e gancho de
exclusão do titular/usuário.

## Escopo (faz)

- Job periódico (padrão dos workers existentes) que elimina conversas/turnos com `created_at` além do prazo
  de retenção (config, default 90 dias — ver doc 17 §6.1).
- Gancho de exclusão: apagar as conversas de um usuário quando ele é removido/anonimizado.
- Nota: o esqueleto não tem PII de cliente, mas a retenção fecha o ciclo de vida (Art. 16); a exclusão do
  cliente já propaga via hidratação (não há PII a apagar aqui) — este slot cobre o dado do **usuário/uso**.

## Fora de escopo (NÃO faz)

- Schema (F6-S24). CRUD (F6-S25). Frontend.

## Arquivos permitidos

- `apps/api/src/workers/**`
- `apps/api/src/modules/assistant-history/**`

## Definition of Done

- [ ] Job de purga por prazo configurável (default 90d); registrado no supervisor
- [ ] Gancho de exclusão por usuário
- [ ] Testes: purga além do prazo, preserva dentro do prazo
- [ ] `pnpm --filter @elemento/api typecheck` + `lint` + `test` verdes

## Notas para o agente

- **Bloqueado até F6-S23.** Prazo de retenção deve refletir o parecer. Não coloque `slot.py validate` no bloco.
