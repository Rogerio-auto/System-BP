---
id: F1-S16
title: Audit logs — schema + helper auditLog()
phase: F1
task_ref: T1.16
status: available
priority: high
estimated_size: S
agent_id: null
claimed_at: null
completed_at: null
pr_url: null
depends_on: [F1-S01]
blocks: []
source_docs:
  - docs/10-seguranca-permissoes.md
  - docs/12-tasks-tecnicas.md#T1.16
---

# F1-S16 — Audit logs

## Objetivo
Tabela `audit_logs` (append-only) e helper `auditLog(tx, { actor, action, resource, before, after, metadata })`.

## Escopo
- Schema: `id, organization_id, actor_user_id, actor_role, action, resource_type, resource_id, before (jsonb), after (jsonb), ip, user_agent, correlation_id, created_at`.
- Função idempotente.
- Retenção: documentar política (sem TTL no MVP).
- Testes.

## Definition of Done
- [ ] Helper testado
- [ ] PR aberto
